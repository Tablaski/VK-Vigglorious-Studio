import asyncio
import bisect
import hashlib
import json
import logging
import math
import re
from pathlib import Path
import uuid
import subprocess
import threading
import time

import folder_paths

from aiohttp import web
from server import PromptServer

from .video_loader import _ffmpeg, _probe, cut_end, frame_times, frame_png, thumbnail_sheet, video_path, decode_args, spatial_plan, read_saved_guides, save_guides
from .video_resolution import resolution_plan


preview_slots = asyncio.Semaphore(2)
background_slots = asyncio.Semaphore(1)
export_slots = asyncio.Semaphore(1)
preview_lock = threading.Lock()
logger = logging.getLogger(__name__)


def cache_file(path, kind, settings, suffix):
    stat = Path(path).stat()
    key = hashlib.sha256(json.dumps([str(path), stat.st_mtime_ns, stat.st_size, kind, settings], sort_keys=True).encode()).hexdigest()
    directory = Path(folder_paths.get_temp_directory()) / "vk-viggle-preview"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{key}{suffix}"


def write_cache(output, data):
    temporary = output.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_bytes(data)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


def video_info(path):
    output = cache_file(path, "info-v1", {}, ".json")
    if output.is_file():
        return json.loads(output.read_text(encoding="utf-8"))
    started = time.monotonic()
    logger.info("[VK Video] Reading source timestamps: %s", Path(path).name)
    ffmpeg = _ffmpeg()
    width, height, fps, duration, _, _ = _probe(ffmpeg, path)
    times = frame_times(ffmpeg, path)
    info = {"width": width, "height": height, "fps": fps, "duration": duration, "times": times}
    write_cache(output, json.dumps(info).encode())
    logger.info("[VK Video] Source indexed: %s | %dx%d | %d frames | %.1f s video | %.2f s elapsed",
                Path(path).name, width, height, len(times), duration, time.monotonic() - started)
    return info


def loaded_settings(query):
    settings = {"start": float(query.get("start", "0")), "end": float(query.get("end", "0")),
                "rate": float(query.get("rate", "0")), "cap": int(query.get("cap", "0")),
                "longest": int(query.get("longest", "0")), "shortest": int(query.get("shortest", "0")),
                "resize_mode": query.get("resize_mode", "auto"), "resolution": query.get("resolution", "")}
    if any(not math.isfinite(settings[key]) or settings[key] < 0 for key in ("start", "end", "rate", "cap", "longest", "shortest")):
        raise ValueError("Video settings must be finite and nonnegative.")
    if settings["resize_mode"] not in ("auto", "none"):
        raise ValueError("Choose auto or none for resize mode.")
    return settings


def loaded_args(path, settings, extra_filters=()):
    ffmpeg = _ffmpeg()
    width, height, _, duration, _, _ = _probe(ffmpeg, path)
    end = cut_end(duration, settings["start"], settings["end"])
    size, crop, filters = spatial_plan(width, height, settings["longest"], settings["shortest"],
                                      settings["resize_mode"], settings["resolution"])
    return decode_args(ffmpeg, path, settings["start"], settings["rate"], settings["cap"], size,
                       (width, height), crop, end, filters, extra_filters)


def preview_limit(query):
    limit = int(query.get("preview_max", "720"))
    if limit not in (0, 480, 720, 1080):
        raise ValueError("Preview resolution must be 480p, 720p, 1080p or Original.")
    return limit


def loaded_preview(path, limit):
    output = cache_file(path, "source-preview-v1", limit, ".mp4")
    if output.is_file():
        return output
    # Only one encoder runs at a time; concurrent users of the same proxy reuse it.
    with preview_lock:
        if output.is_file():
            return output
        temporary = output.with_suffix(f".{uuid.uuid4().hex}.mp4")
        try:
            info = video_info(path)
            scale = min(1, limit / min(info["width"], info["height"])) if limit else 1
            width, height = (max(2, int(info[key] * scale) // 2 * 2) for key in ("width", "height"))
            filters = f"scale={width}:{height},setsar=1,setpts=PTS-STARTPTS"
            started = time.monotonic()
            logger.info("[VK Video] Encoding player preview: %s | %dx%d | %.1f s video",
                        Path(path).name, width, height, info["duration"])
            subprocess.run([_ffmpeg(), "-v", "error", "-nostdin", "-i", path, "-map", "0:v:0", "-an", "-vf", filters,
                            "-vsync", "0", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                            "-g", "12", "-keyint_min", "12", "-sc_threshold", "0", "-bf", "0",
                            "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(temporary)], capture_output=True, check=True)
            temporary.replace(output)
            logger.info("[VK Video] Player preview encoded: %s | %.2f s elapsed | %.1f MiB",
                        Path(path).name, time.monotonic() - started, output.stat().st_size / (1024 * 1024))
        finally:
            temporary.unlink(missing_ok=True)
    return output


def cut_info(path, settings):
    temporal = {key: settings[key] for key in ("start", "end", "rate", "cap")}
    output = cache_file(path, "cut-info-v2", temporal, ".json")
    source = video_info(path)
    if output.is_file():
        info = json.loads(output.read_text(encoding="utf-8"))
    else:
        end = cut_end(source["duration"], settings["start"], settings["end"])
        if not settings["rate"]:
            first = bisect.bisect_left(source["times"], settings["start"] - 0.000001)
            last = bisect.bisect_left(source["times"], end - 0.000001)
            if settings["cap"]:
                last = min(last, first + settings["cap"])
            source_times = source["times"][first:last]
            times = [time - settings["start"] for time in source_times]
        else:
            args = decode_args(_ffmpeg(), path, settings["start"], settings["rate"], settings["cap"], (2, 2),
                               (source["width"], source["height"]), end_time=end,
                               spatial_filters=["scale=2:2"], extra_filters=["setpts=PTS-STARTPTS", "showinfo"])
            args[args.index("error")] = "info"
            result = subprocess.run([*args, "-vsync", "0", "-f", "null", "-"], capture_output=True, check=True)
            times = [float(value) for value in re.findall(r"\bn:\s*\d+.*?pts_time:([\d.eE+\-]+)", result.stderr.decode(errors="replace"))]
            if settings["cap"]:
                times = times[:settings["cap"]]
        fps = settings["rate"] or source["fps"]
        duration = min(end - settings["start"], (times[-1] + 1 / fps) if times else 0)
        if not settings["rate"] and times:
            duration = min(end, source["times"][last] if last < len(source["times"]) else source["duration"]) - settings["start"]
        info = {"times": times, "frame_count": len(times), "fps": fps, "duration": duration}
        if settings["rate"] and times:
            first = bisect.bisect_left(source["times"], settings["start"] - 0.000001)
            last = bisect.bisect_left(source["times"], end - 0.000001)
            source_times = source["times"][first:last]
            ticks = [math.floor((time - settings["start"]) * fps + 0.5 + 0.000001) for time in source_times]
            # FFmpeg fps rounds input timestamps to output ticks and retains the last frame at each tick.
            info["seek_times"] = [source_times[max(0, bisect.bisect_right(ticks, ticks[0] + index) - 1)] for index in range(len(times))]
        write_cache(output, json.dumps(info).encode())
    size, _, _ = spatial_plan(source["width"], source["height"], settings["longest"], settings["shortest"],
                              settings["resize_mode"], settings["resolution"])
    return {**info, "width": size[0], "height": size[1]}


def loaded_png(path, settings, frames, thumbnails=False):
    output = cache_file(path, "loaded-sheet-v1" if thumbnails else "loaded-frame-v1", [settings, frames], ".png")
    if output.is_file():
        return output.read_bytes()
    select = "+".join(f"eq(n\\,{frame - 1})" for frame in frames)
    filters = ["format=rgb24", f"select={select}"]
    if thumbnails:
        filters += ["scale=160:90:force_original_aspect_ratio=decrease", "pad=160:90:(ow-iw)/2:(oh-ih)/2", f"tile={len(frames)}x1"]
    if not thumbnails and not settings["rate"]:
        info = cut_info(path, settings)
        if frames[0] > len(info["times"]):
            raise ValueError("Selected frame is outside the loaded video.")
        time = settings["start"] + info["times"][frames[0] - 1]
        args = loaded_args(path, {**settings, "start": max(0, time - 0.000001)}, ["format=rgb24"])
    else:
        args = loaded_args(path, settings, filters)
    # A frame or sprite is one PNG, regardless of the loaded-video frame cap.
    if "-frames:v" in args:
        limit = args.index("-frames:v")
        del args[limit:limit + 2]
    result = subprocess.run([*args, "-frames:v", "1", "-vsync", "0", "-f", "image2pipe", "-c:v", "png", "-"], capture_output=True, check=True)
    if not result.stdout:
        raise ValueError("Selected frame is outside the loaded video.")
    write_cache(output, result.stdout)
    return result.stdout


def export_cut(path, settings):
    output = cache_file(path, "export-cut-v1", settings, ".mp4")
    if output.is_file():
        return output
    info = cut_info(path, settings)
    if not info["frame_count"]:
        raise ValueError("The cut contains no frames.")
    video = output.with_suffix(f".{uuid.uuid4().hex}.video.mp4")
    temporary = output.with_suffix(f".{uuid.uuid4().hex}.mp4")
    started = time.monotonic()
    logger.info("[VK Video] Exporting cut: %s | start %.3f s | %d frames | %dx%d | %.3f FPS",
                Path(path).name, settings["start"], info["frame_count"], info["width"], info["height"], info["fps"])
    try:
        pixel_format = "yuv420p" if info["width"] % 2 == info["height"] % 2 == 0 else "yuv444p"
        subprocess.run([*loaded_args(path, settings, ["setsar=1", "setpts=PTS-STARTPTS"]),
                        "-vsync", "0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                        "-pix_fmt", pixel_format, "-movflags", "+faststart", str(video)], capture_output=True, check=True)
        if _probe(_ffmpeg(), path)[5]:
            # Mux audio after encoding so the frame cap cannot stop its encoding early.
            subprocess.run([_ffmpeg(), "-v", "error", "-nostdin", "-ss", str(settings["start"]), "-i", path,
                            "-i", str(video), "-map", "1:v:0", "-map", "0:a:0", "-c:v", "copy",
                            "-af", f"atrim=duration={info['duration']},asetpts=PTS-STARTPTS",
                            "-c:a", "aac", "-b:a", "192k", "-t", str(info["duration"]),
                            "-movflags", "+faststart", str(temporary)], capture_output=True, check=True)
            temporary.replace(output)
        else:
            video.replace(output)
        logger.info("[VK Video] Cut exported: %s | %.2f s elapsed | %.1f MiB", Path(path).name,
                    time.monotonic() - started, output.stat().st_size / (1024 * 1024))
    finally:
        video.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)
    return output


@PromptServer.instance.routes.post("/vk-viggle/video/export")
async def export(request):
    try:
        path = video_path(request.query.get("video", ""))
        settings = loaded_settings(request.query)
        async with export_slots:
            output = await asyncio.to_thread(export_cut, path, settings)
        return web.FileResponse(output, headers={"Cache-Control": "no-store", "Content-Disposition": "attachment"})
    except (ValueError, OSError, subprocess.CalledProcessError, RuntimeError) as error:
        logger.warning("[VK Video] Cut export failed for %s: %s", request.query.get("video", ""), error)
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.post("/vk-viggle/video/guides")
async def save_video_guides(request):
    try:
        data = await request.json()
        if not isinstance(data, dict) or not isinstance(data.get("video"), str) or not isinstance(data.get("config"), dict):
            raise ValueError("Provide a video and guide configuration.")
        path = video_path(data["video"])
        await asyncio.to_thread(save_guides, path, data["video"], json.dumps(data["config"]))
        return web.json_response({"saved": True}, headers={"Cache-Control": "no-store"})
    except (ValueError, OSError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.get("/vk-viggle/video/{action}")
async def preview(request):
    try:
        path = video_path(request.query.get("video", ""))
        action = request.match_info["action"]
        started = time.monotonic()
        if action in ("info", "cut"):
            logger.info("[VK Video] %s requested: %s", "Source analysis" if action == "info" else "Player preparation", request.query.get("video"))
        if action == "player":
            output = cache_file(path, "source-preview-v1", preview_limit(request.query), ".mp4")
            if output.is_file():
                return web.FileResponse(output, headers={"Cache-Control": "private, max-age=0, must-revalidate"})
        slots = background_slots if action in ("info", "cut", "player", "thumbnails") else preview_slots
        async with slots:
            if action == "info":
                info = await asyncio.to_thread(video_info, path)
                info["saved_guides"] = await asyncio.to_thread(read_saved_guides, path)
                logger.info("[VK Video] Source ready: %s | %d frames | %.2f s elapsed (including queue)",
                            request.query.get("video"), len(info["times"]), time.monotonic() - started)
                return web.json_response(info, headers={"Cache-Control": "no-store"})
            if action == "cut":
                settings = loaded_settings(request.query)
                limit = preview_limit(request.query)
                cached = cache_file(path, "source-preview-v1", limit, ".mp4").is_file()
                await asyncio.to_thread(loaded_preview, path, limit)
                info = await asyncio.to_thread(cut_info, path, settings)
                logger.info("[VK Video] Player ready: %s | preview %s | start %.3f s | %d loaded frames | %.2f s elapsed (including queue)",
                            request.query.get("video"), "cached" if cached else "encoded", settings["start"],
                            info["frame_count"], time.monotonic() - started)
                return web.json_response(info, headers={"Cache-Control": "no-store"})
            if action == "player":
                output = await asyncio.to_thread(loaded_preview, path, preview_limit(request.query))
                return web.FileResponse(output, headers={"Cache-Control": "private, max-age=0, must-revalidate"})
            if action == "resolution":
                width, height, *_ = await asyncio.to_thread(_probe, _ffmpeg(), path)
                plan = resolution_plan(width, height, request.query.get("resolution", "{}"))
                return web.json_response(plan, headers={"Cache-Control": "no-store"})
            if action == "frame":
                frame = int(request.query.get("frame", "1"))
                if frame < 1:
                    raise ValueError("Frame numbers start at 1.")
                if request.query.get("loaded") == "1":
                    settings = loaded_settings(request.query)
                    if settings["cap"] and frame > settings["cap"]:
                        raise ValueError("Selected frame exceeds frame cap.")
                    data = await asyncio.to_thread(loaded_png, path, settings, [frame])
                    return web.Response(body=data, content_type="image/png", headers={"Cache-Control": "no-store"})
                filters = None
                if request.query.get("resolution"):
                    width, height, *_ = await asyncio.to_thread(_probe, _ffmpeg(), path)
                    filters = resolution_plan(width, height, request.query["resolution"])["filters"]
                output = cache_file(path, "source-frame-v1", [frame, filters], ".png")
                if output.is_file():
                    data = await asyncio.to_thread(output.read_bytes)
                else:
                    data = await asyncio.to_thread(frame_png, _ffmpeg(), path, frame, filters)
                    await asyncio.to_thread(write_cache, output, data)
            elif action == "thumbnails":
                frames = sorted(set(int(value) for value in request.query.get("frames", "1").split(",")))
                if not 1 <= len(frames) <= 12 or frames[0] < 1:
                    raise ValueError("Request between 1 and 12 source thumbnails.")
                if "preview_max" in request.query:
                    limit = preview_limit(request.query)
                    source = await asyncio.to_thread(video_info, path)
                    output = await asyncio.to_thread(loaded_preview, path, limit)
                    if request.query.get("loaded") == "1":
                        settings = loaded_settings(request.query)
                        info = await asyncio.to_thread(cut_info, path, settings)
                        if frames[-1] > len(info["times"]):
                            raise ValueError("Selected frame is outside the loaded video.")
                        data = await asyncio.to_thread(loaded_png, str(output), settings, frames, True)
                    elif frames[-1] > len(source["times"]):
                        raise ValueError("Selected frame is outside the video.")
                    else:
                        sheet = cache_file(path, "proxy-sheet-v1", [limit, frames], ".png")
                        if sheet.is_file():
                            data = await asyncio.to_thread(sheet.read_bytes)
                        else:
                            data = await asyncio.to_thread(thumbnail_sheet, _ffmpeg(), str(output), frames)
                            await asyncio.to_thread(write_cache, sheet, data)
                elif request.query.get("loaded") == "1":
                    settings = loaded_settings(request.query)
                    if settings["cap"] and frames[-1] > settings["cap"]:
                        raise ValueError("Selected frame exceeds frame cap.")
                    data = await asyncio.to_thread(loaded_png, path, settings, frames, True)
                else:
                    data = await asyncio.to_thread(thumbnail_sheet, _ffmpeg(), path, frames)
            else:
                raise web.HTTPNotFound()
        return web.Response(body=data, content_type="image/png", headers={"Cache-Control": "no-store"})
    except (ValueError, OSError, subprocess.CalledProcessError, RuntimeError) as error:
        logger.warning("[VK Video] %s failed for %s: %s", request.match_info["action"], request.query.get("video", ""), error)
        return web.json_response({"error": str(error)}, status=400)
