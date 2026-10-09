# FFmpeg decoding adapted from VK Load Video FFMPEG (GPL-3.0),
# a self-contained implementation of the VHS FFmpeg upload loader.
import bisect
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import uuid
from collections.abc import Mapping
from pathlib import Path

import numpy as np
import torch

import folder_paths
from .video_resolution import resolution_plan


VIDEO_EXTENSIONS = {"webm", "mp4", "mkv", "gif", "mov"}
GUIDE_DEFAULTS = {
    "head": {"sam_prompt": "head, hair", "head_prompt": "", "body_prompt": "", "mask_mode": "sam3"},
    "both": {"sam_prompt": "person", "head_prompt": "", "body_prompt": "", "mask_mode": "sam3"},
    "body": {"sam_prompt": "person", "head_prompt": "", "body_prompt": "", "mask_mode": "sam3"},
}


def guide_settings(selection, time):
    item = selection.get("settings", {}).get(str(time), {})
    mode = item.get("swap_mode", "head")
    if mode not in GUIDE_DEFAULTS:
        raise ValueError("VK Viggle: swap mode must be head, both or body.")
    defaults = {**GUIDE_DEFAULTS[mode], **selection.get("defaults", {}).get(mode, {})}
    result = {"swap_mode": mode, **defaults, **item}
    chunk = result.get("reference_chunk")
    if chunk is not None and (type(chunk) is not int or chunk < 1):
        raise ValueError("VK Viggle: reference chunk must be a positive integer.")
    if result["mask_mode"] not in ("sam3", "none"):
        raise ValueError("VK Viggle: mask mode must be sam3 or none.")
    for key in ("sam_prompt", "head_prompt", "body_prompt"):
        if not isinstance(result[key], str):
            raise ValueError(f"VK Viggle: {key} must be text.")
    return result


def guide_config(config):
    selection = json.loads(config) if config else {}
    if not isinstance(selection, dict) or not isinstance(selection.get("times", []), list):
        raise ValueError("VK Viggle: guide selection must be a JSON object with a times list.")
    if not isinstance(selection.get("angles", {}), dict) or not isinstance(selection.get("body_angles", {}), dict):
        raise ValueError("VK Viggle: guide angles must map timestamps to angle ids.")
    for time in selection.get("times", []):
        if not isinstance(time, (int, float)) or not math.isfinite(time):
            raise ValueError("VK Viggle: guide times must be finite source-video seconds.")
    for key in ("settings", "defaults"):
        if not isinstance(selection.get(key, {}), dict) or any(not isinstance(item, dict) for item in selection.get(key, {}).values()):
            raise ValueError(f"VK Viggle: guide {key} must contain JSON objects.")
    for time in selection.get("times", []):
        guide_settings(selection, time)
    if "reference" in selection:
        reference = selection["reference"]
        if not isinstance(reference, dict) or not isinstance(reference.get("time"), (int, float)) or not math.isfinite(reference["time"]) or reference["time"] < 0 or not isinstance(reference.get("settings"), dict):
            raise ValueError("VK Viggle: reference must contain finite source-video seconds and a settings object.")
        guide_settings({"settings": {"ref": reference["settings"]}}, "ref")
    return selection


def selected_guides(config, video, loaded_times, end):
    selection = guide_config(config)
    if selection.get("video", video) != video:
        return {}
    frames = {}
    angles = {float(time): angle for time, angle in selection.get("angles", {}).items()}
    body_angles = {float(time): angle for time, angle in selection.get("body_angles", {}).items()}
    for time in selection.get("times", []):
        if time < loaded_times[0] - 0.000001 or time >= end - 0.000001:
            continue
        right = min(bisect.bisect_left(loaded_times, time), len(loaded_times) - 1)
        left = max(0, right - 1)
        frame = min((left, right), key=lambda index: abs(loaded_times[index] - time))
        frames.setdefault(frame, {"seconds": loaded_times[frame], "angle_id": angles.get(time), "body_angle_id": body_angles.get(time), **guide_settings(selection, time)})
    return dict(sorted(frames.items()))


def _ffmpeg():
    path = os.environ.get("VHS_FORCE_FFMPEG_PATH") or shutil.which("ffmpeg")
    if path:
        return path
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
    except ImportError as error:
        raise RuntimeError("FFmpeg is required for VK Viggle Video Loader.") from error
    return get_ffmpeg_exe()


def _probe(ffmpeg, path):
    result = subprocess.run([ffmpeg, "-hide_banner", "-i", path], capture_output=True)
    output = result.stderr.decode(errors="replace")
    stream = re.search(r"Stream #\d+:\d+.*?Video:.*?,\s*(\d+)x(\d+).*", output)
    if stream is None:
        raise RuntimeError(f"FFmpeg could not read the video stream:\n{output}")
    width, height = int(stream.group(1)), int(stream.group(2))
    rotation = re.search(r"rotation of (-?\d+(?:\.\d+)?)", output) or re.search(r"\brotate\s*:\s*(-?\d+)", output)
    if rotation and round(float(rotation.group(1))) % 180 == 90:
        width, height = height, width
    fps_match = re.search(r"(\d+(?:\.\d+)?) fps", stream.group())
    fps = float(fps_match.group(1)) if fps_match else 1.0
    duration_match = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", output)
    duration = (int(duration_match.group(1)) * 3600 + int(duration_match.group(2)) * 60 + float(duration_match.group(3))) if duration_match else 0.0
    alpha = re.search(r"\b(?:yuva\w*|rgba\w*|bgra\w*|gbra\w*)\b", stream.group()) is not None
    audio_stream = re.search(r"Stream #\d+:\d+.*?Audio:.*", output)
    sample_rate = re.search(r"(\d+) Hz", audio_stream.group()) if audio_stream else None
    return width, height, fps, duration, alpha, int(sample_rate.group(1)) if sample_rate else None


def decode_args(ffmpeg, path, start_time, force_rate, frame_load_cap, size, source_size, crop=False, end_time=0, spatial_filters=None, extra_filters=()):
    seek = ["-ss", str(start_time)] if start_time else []
    args = [ffmpeg, "-v", "error", "-nostdin", "-an", *seek, "-i", path, "-map", "0:v:0"]
    filters = []
    if end_time:
        filters.append(f"trim=duration={end_time - start_time}")
    if force_rate:
        filters.append(f"fps={force_rate}")
    if spatial_filters is not None:
        filters.extend(spatial_filters)
    elif crop:
        aspect = size[0] / size[1]
        filters.append(f"crop=if(gt({aspect}\\,a)\\,iw\\,ih*{aspect}):if(gt({aspect}\\,a)\\,iw/{aspect}\\,ih)")
    if spatial_filters is None and size != source_size:
        filters.append(f"scale={size[0]}:{size[1]}")
    filters.extend(extra_filters)
    if filters:
        args += ["-vf", ",".join(filters)]
    if frame_load_cap:
        args += ["-frames:v", str(frame_load_cap)]
    return args


def _read_frames(ffmpeg, path, alpha, start_time, force_rate, frame_load_cap, size, source_size, crop=False, end_time=0, spatial_filters=None):
    args = decode_args(ffmpeg, path, start_time, force_rate, frame_load_cap, size, source_size, crop, end_time, spatial_filters)
    channels = 4 if alpha else 3
    pixel_format = "rgba" if alpha else "rgb24"
    args += ["-vsync", "0", "-f", "rawvideo", "-pix_fmt", pixel_format, "-"]
    frame_size = size[0] * size[1] * channels
    frames = []
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        while True:
            frame = bytearray(frame_size)
            view = memoryview(frame)
            received = 0
            while received < frame_size:
                count = process.stdout.readinto(view[received:])
                if not count:
                    break
                received += count
            if received == 0:
                break
            if received != frame_size:
                raise RuntimeError("FFmpeg returned an incomplete video frame.")
            frames.append(frame)
            if frame_load_cap and len(frames) >= frame_load_cap:
                break
        error = process.stderr.read().decode(errors="replace")
        if process.wait():
            raise RuntimeError(f"FFmpeg failed to decode the video:\n{error}")
    if not frames:
        raise RuntimeError(f"No frames generated. {error}")
    array = np.frombuffer(bytearray().join(frames), dtype=np.uint8).reshape(-1, size[1], size[0], channels)
    return torch.from_numpy(array).float().div_(255)


class _LazyAudio(Mapping):
    def __init__(self, ffmpeg, path, start_time, duration, sample_rate):
        self.ffmpeg = ffmpeg
        self.path = path
        self.start_time = start_time
        self.duration = duration
        self.sample_rate = sample_rate
        self.audio = None

    def _load(self):
        if self.audio is None:
            if self.sample_rate is None:
                self.audio = {"waveform": torch.empty(1, 2, 0), "sample_rate": 44100}
                return self.audio
            args = [self.ffmpeg, "-v", "error", "-nostdin", "-i", self.path]
            if self.start_time:
                args += ["-ss", str(self.start_time)]
            if self.duration:
                args += ["-t", str(self.duration)]
            args += ["-map", "0:a:0", "-vn", "-ac", "2", "-ar", str(self.sample_rate), "-f", "f32le", "-"]
            result = subprocess.run(args, capture_output=True, check=True)
            samples = torch.frombuffer(bytearray(result.stdout), dtype=torch.float32).reshape(-1, 2).T.unsqueeze(0)
            self.audio = {"waveform": samples, "sample_rate": self.sample_rate}
        return self.audio

    def __getitem__(self, key):
        return self._load()[key]

    def __iter__(self):
        return iter(self._load())

    def __len__(self):
        return len(self._load())


def video_path(video):
    root = Path(folder_paths.get_input_directory()).resolve()
    path = (root / video).resolve()
    if not path.is_relative_to(root) or path.suffix[1:].lower() not in VIDEO_EXTENSIONS or not path.is_file():
        raise ValueError("Choose a video inside the ComfyUI input directory.")
    return str(path)


def guide_file(path):
    stat = Path(path).stat()
    key = hashlib.sha256(json.dumps([str(Path(path).resolve()), stat.st_mtime_ns, stat.st_size]).encode()).hexdigest()
    return Path(folder_paths.get_output_directory()) / "vk-viggle-guides" / f"{key}.json"


def read_saved_guides(path):
    file = guide_file(path)
    return json.loads(file.read_text(encoding="utf-8")) if file.is_file() else None


def save_guides(path, video, config):
    selection = guide_config(config) if config else {"video": video, "times": [], "angles": {}}
    if selection.get("video", video) != video:
        raise ValueError("VK Viggle: guide selection must belong to the loaded video.")
    selection["video"] = video
    file = guide_file(path)
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(selection), encoding="utf-8")
        temporary.replace(file)
    finally:
        temporary.unlink(missing_ok=True)


def target_size(width, height, longest_side, shortest_side):
    long, short = max(width, height), min(width, height)
    if not longest_side and not shortest_side:
        return width, height
    if not longest_side:
        longest_side = max(1, round(long * shortest_side / short))
    if not shortest_side:
        shortest_side = max(1, round(short * longest_side / long))
    return (longest_side, shortest_side) if width >= height else (shortest_side, longest_side)


def spatial_plan(width, height, longest_side=0, shortest_side=0, resize_mode="auto", resolution_config=""):
    size = (width, height) if resize_mode == "none" else target_size(width, height, longest_side, shortest_side)
    crop = resize_mode == "auto" and bool(longest_side and shortest_side and size[0] * height != size[1] * width)
    filters = None
    if resolution_config:
        plan = resolution_plan(width, height, resolution_config)
        size = plan["width"], plan["height"]
        filters = plan["filters"]
    return size, crop, filters


def reference_index(times, start_time, force_rate, source_frame, count):
    source_frame = min(max(1, source_frame), len(times))
    if force_rate:
        index = int((times[source_frame - 1] - start_time) * force_rate + 0.5)
    else:
        index = source_frame - 1 - bisect.bisect_left(times, start_time - 0.000001)
    return min(max(0, index), count - 1)


def frame_times(ffmpeg, path):
    stat = Path(path).stat()
    key = hashlib.sha256(json.dumps([str(Path(path).resolve()), stat.st_mtime_ns, stat.st_size]).encode()).hexdigest()
    directory = Path(folder_paths.get_temp_directory()) / "vk-viggle-timestamps"
    directory.mkdir(parents=True, exist_ok=True)
    output = directory / f"{key}.json"
    if output.is_file():
        return json.loads(output.read_text(encoding="utf-8"))
    # Decode presentation timestamps rather than assuming constant frame rate.
    result = subprocess.run([ffmpeg, "-hide_banner", "-nostdin", "-i", path,
                             "-map", "0:v:0", "-an", "-vf", "scale=2:2,showinfo",
                             "-vsync", "0", "-f", "null", "-"], capture_output=True, check=True)
    times = [float(value) for value in re.findall(r"\bn:\s*\d+.*?pts_time:([\d.eE+\-]+)", result.stderr.decode(errors="replace"))]
    if not times:
        raise ValueError("The video contains no decodable frames.")
    origin = times[0]
    times = [time - origin for time in times]
    temporary = output.with_suffix(f".{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(times), encoding="utf-8")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    return times


def cut_end(duration, start_time, end_time):
    if end_time and end_time <= start_time:
        raise ValueError("End time must be after start time.")
    return min(end_time or duration, duration)


def cut_bounds(times, duration, start_time, end_time, force_rate, loaded_count):
    first = bisect.bisect_left(times, start_time - 0.000001)
    end = cut_end(duration, start_time, end_time)
    if force_rate:
        end = min(end, start_time + loaded_count / force_rate)
    elif first + loaded_count < len(times):
        end = min(end, times[first + loaded_count])
    last = bisect.bisect_left(times, end - 0.000001)
    return first, max(first + 1, last), end


def frame_png(ffmpeg, path, frame, spatial_filters=None):
    times = frame_times(ffmpeg, path)
    if frame < 1 or frame > len(times):
        raise ValueError("Selected frame is outside the video.")
    seek = max(0, times[frame - 1] - 0.000001)
    filters = ["-vf", ",".join(spatial_filters)] if spatial_filters else []
    result = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-ss", str(seek), "-i", path,
                             "-map", "0:v:0", "-an", *filters, "-frames:v", "1",
                             "-vsync", "0", "-f", "image2pipe", "-c:v", "png", "-"],
                            capture_output=True, check=True)
    if not result.stdout:
        raise ValueError("Selected frame is outside the video.")
    return result.stdout


def thumbnail_sheet(ffmpeg, path, frames):
    select = "+".join(f"eq(n\\,{frame - 1})" for frame in frames)
    filters = f"select={select},scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile={len(frames)}x1"
    result = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-i", path, "-map", "0:v:0", "-an",
                             "-vf", filters, "-frames:v", "1", "-vsync", "0", "-f", "image2pipe",
                             "-c:v", "png", "-"], capture_output=True, check=True)
    if not result.stdout:
        raise ValueError("The video contains no decodable thumbnails.")
    return result.stdout


class VKViggleVideoLoader:
    @classmethod
    def INPUT_TYPES(cls):
        root = Path(folder_paths.get_input_directory())
        files = sorted(path.relative_to(root).as_posix() for path in root.rglob("*")
                       if path.is_file() and path.suffix[1:].lower() in VIDEO_EXTENSIONS)
        return {"required": {
            "video": (files, {"tooltip": "Upload or choose a video from the ComfyUI input directory."}),
            "force_rate": ("FLOAT", {"default": 0, "min": 0, "max": 60, "step": 1,
                "tooltip": "Loaded frames per second. 0 keeps the source rate. Start with 24 for Viggle."}),
            "longest_side": ("INT", {"default": 0, "min": 0, "max": 16384,
                "tooltip": "Long edge in pixels in auto mode: width for landscape, height for portrait. 0 derives it from shortest side, or keeps source size when both are 0. Ignored in none mode or when a Resolution dialog profile is applied."}),
            "shortest_side": ("INT", {"default": 0, "min": 0, "max": 16384,
                "tooltip": "Short edge in pixels in auto mode: height for landscape, width for portrait. 0 preserves aspect ratio from longest side. Both nonzero center-crop to the requested size. Ignored in none mode or when a Resolution dialog profile is applied."}),
            "frame_load_cap": ("INT", {"default": 0, "min": 0, "max": 2147483647,
                "tooltip": "Maximum loaded frames counted from start time. 0 loads the entire cut. Loading stops at the earlier of this cap and end time. The player uses a minimum of 5 loaded frames for Viggle."}),
            "start_time": ("FLOAT", {"default": 0, "min": 0, "max": 2147483647, "step": 0.001,
                "tooltip": "Cut start in source-video seconds. Mark Start sets this from the timeline. All outputs use the cut."}),
            "selected_frame_number": ("INT", {"default": 1, "min": 1, "max": 2147483647,
                "tooltip": "One-based loaded frame number in the player, saved with the workflow. Ref Frame is copied from IMAGE. Old source-frame selections are mapped to the nearest loaded frame."}),
        }, "optional": {
            "resize_mode": (["auto", "none"], {"default": "auto",
                "tooltip": "auto resizes/crops by orientation. none keeps source dimensions. Applied Resolution dialog settings override this mode and both side settings for IMAGE, Ref Frame and first_frame."}),
            "end_time": ("FLOAT", {"default": 0, "min": 0, "max": 2147483647, "step": 0.001,
                "tooltip": "Cut end in source-video seconds, exclusive. 0 uses the original video's end. Mark End includes the current frame; without Mark Start, the cut starts at frame 1. Must be after start time. The earlier of end time and frame cap wins."}),
            "chunk_frames": ("INT", {"default": 124, "min": 22, "max": 3600, "step": 17,
                "tooltip": "Frames per Viggle window. Start with 124, matching Windowed Conditioning. Larger windows need fewer chunks and more VRAM. Connect the chunk_frames output to its chunk_frames input. The player counts chunks for five_frame_anchor continuation, including H3 frame rounding."}),
            "resolution_config": ("STRING", {"default": "",
                "tooltip": "Resolution dialog settings saved as JSON. Use Resolution… in the player. Empty keeps the existing resize settings. Applied settings override longest/shortest side and resize_mode for all image outputs."}),
            "reference_frame_space": (["source", "loaded"], {"default": "source",
                "tooltip": "Saved frame numbering: source for old workflows, loaded for the current player. The player converts old selections automatically. Both modes select a frame from IMAGE."}),
            "reference_angles": ("VIGGLE_REFERENCE_ANGLES", {"label": "reference angles (head)", "tooltip": "Head reference collection from the Character Reference Manager. Choose a head angle for each guide. Without a collection, use a separately connected head-swap reference."}),
            "body_reference_angles": ("VIGGLE_REFERENCE_ANGLES", {"label": "reference angles (body)", "tooltip": "Full-body reference collection from the Character Reference Manager. Choose a body angle for each guide. Without a collection, use a separately connected body-swap reference."}),
            "guide_selection": ("STRING", {"default": "", "tooltip": "Guide selection saved by the player as source-video timestamps. Add, replace or remove guides in its chunk gallery and enable Chunk Ref Frame beside the prompt shortcuts before adding a guide inside the inspected chunk, or promote a selected guide with Chunk Ref. Frames outside the effective cut are not used."}),
            "auto_save_guides": ("BOOLEAN", {"default": False,
                "tooltip": "Replace this video's local save with all guides, chunk reference assignments and swap settings when this loader runs. Loading the video restores the last save. Off keeps the previous save; Save All Guides in the player saves without running."}),
            "reference_settings": ("STRING", {"default": "", "tooltip": "Saved global-reference settings for existing workflows. New chunk references use their own guide settings in the gallery."}),
            "prompt_defaults": ("STRING", {"default": "", "tooltip": "Shared prompt and mask defaults by swap mode, independent of the current video. Saved in the workflow and browser; individual frame overrides take precedence."}),
        }}

    RETURN_TYPES = ("IMAGE", "AUDIO", "IMAGE", "IMAGE", "INT", "VIGGLE_GUIDE_SELECTION", "IMAGE", "IMAGE", "BOOLEAN", "BOOLEAN", "STRING", "STRING")
    RETURN_NAMES = ("IMAGE", "audio", "Ref Frame", "first_frame", "chunk_frames", "guide_selection", "ref_head_image", "ref_body_image", "ref_enable_head_swap", "ref_enable_body_swap", "ref_head_additional_prompt", "ref_body_additional_prompt")
    OUTPUT_TOOLTIPS = ("Video frames after start, rate and size settings. Connect to Viggle source video.",
                       "Audio matching the loaded video segment; silent videos have an empty waveform.",
                       "Source image for the earliest assigned reference chunk, or the saved global reference if none is assigned. Connect through the global reference swap to Windowed Conditioning ref_image. Prepare Chunk Guides can reuse it and swap only other chunk references.",
                       "First loaded frame as a single IMAGE, after start time and frame-rate settings, using the same resize/crop as IMAGE. Independent of the player selection. Connect to Preview Image or a first-frame guide.",
                       "The chosen window length in frames, unchanged. Connect to Windowed Conditioning chunk_frames; convert that widget to an input if needed.",
                       "Selected loaded frame positions, source-video times and assigned reference angles. Connect to VK Vigglorious Prepare Chunk Guides with the same IMAGE video and Loop Start state.",
                       "Head image for the earliest assigned chunk reference, or the saved global reference. Connect to the reference-frame swap head reference input.",
                       "Full-body image for the earliest assigned chunk reference, or the saved global reference. Connect to its full-body reference input.",
                       "Enable the Ref Frame head pass. In Full body then Head, this pass follows the full-body pass.",
                       "Enable the Ref Frame full-body pass. Connect to Enable character swap.",
                       "Resolved additional Qwen instructions for the Ref Frame head pass, supplementing its base prompt.",
                       "Resolved additional Qwen instructions for the Ref Frame full-body pass, supplementing its base prompt.")
    DESCRIPTION = "Manage video cuts, resolution and per-guide Head, Full body or Full body then Head swaps. Assign one guide as the native reference for each chunk; missing chunks use the nearest assignment, with earlier chunks winning ties. Reference angles and prompt overrides are independent for each frame. Image outputs use the effective cut."
    FUNCTION = "load_video"
    CATEGORY = "VK/Viggle"

    def load_video(self, video, force_rate, longest_side, shortest_side, frame_load_cap, start_time, selected_frame_number=1, resize_mode="auto", end_time=0, chunk_frames=124, resolution_config="", reference_frame_space="source", guide_selection="", reference_angles=None, auto_save_guides=False, body_reference_angles=None, reference_settings="", prompt_defaults=""):
        path = video_path(video)
        ffmpeg = _ffmpeg()
        width, height, fps, duration, alpha, sample_rate = _probe(ffmpeg, path)
        end = cut_end(duration, start_time, end_time)
        size, crop, spatial_filters = spatial_plan(width, height, longest_side, shortest_side, resize_mode, resolution_config)
        images = _read_frames(ffmpeg, path, alpha, start_time, force_rate, frame_load_cap, size, (width, height), crop, end, spatial_filters)
        images = images[:, :, :, :3]
        times = frame_times(ffmpeg, path)
        first, last, end = cut_bounds(times, duration, start_time, end_time, force_rate, len(images))
        index = min(max(0, selected_frame_number - 1), len(images) - 1) if reference_frame_space == "loaded" else reference_index(times, start_time, force_rate, selected_frame_number, len(images))
        selected = images[index:index + 1].clone()
        audio = _LazyAudio(ffmpeg, path, start_time, end - start_time, sample_rate)
        loaded_times = ([start_time + index / force_rate for index in range(len(images))]
                        if force_rate else times[first:first + len(images)])
        config = guide_config(guide_selection)
        defaults = json.loads(prompt_defaults) if prompt_defaults else config.get("defaults", {})
        config["defaults"] = defaults
        if auto_save_guides:
            config.setdefault("times", [])
            save_guides(path, video, json.dumps(config))
        guides = selected_guides(json.dumps(config), video, loaded_times, end)
        for references, key, label in ((reference_angles, "angle_id", "head"), (body_reference_angles, "body_angle_id", "body")):
            if references is not None:
                for frame, guide in guides.items():
                    reference = references.get(guide[key])
                    if guide["swap_mode"] == ("body" if label == "head" else "head"):
                        continue
                    if reference is None or reference["image"] is None:
                        raise ValueError(f"Viggle: choose a loaded {label} reference angle for guide frame {frame + 1}.")
        guides = {"frames": guides, "references": reference_angles or {}, "body_references": body_reference_angles or {}}
        settings = json.loads(reference_settings) if reference_settings else {}
        assigned = [(guide["reference_chunk"], frame, guide) for frame, guide in guides["frames"].items() if guide.get("reference_chunk") is not None]
        if assigned:
            _, index, settings = min(assigned, key=lambda item: (item[0], item[1]))
            selected = images[index:index + 1].clone()
        guides["initial_reference_frame"] = index
        ref = guide_settings({"settings": {"ref": settings}, "defaults": defaults}, "ref")
        ref_images = []
        for references, key, active, label in ((reference_angles, "angle_id", ref["swap_mode"] != "body", "head"),
                                               (body_reference_angles, "body_angle_id", ref["swap_mode"] != "head", "full-body")):
            references = references or {}
            angle = references.get(settings[key]) if settings.get(key) else next(iter(references.values()), None)
            if active and settings.get(key) and (angle is None or angle["image"] is None):
                raise ValueError(f"Viggle: choose a loaded {label} reference angle for Ref Frame.")
            ref_images.append(angle["image"] if angle and angle["image"] is not None else (None if active else selected))
        return (images, audio, selected, images[:1].clone(), chunk_frames, guides,
                *ref_images, ref["swap_mode"] != "body", ref["swap_mode"] != "head", ref["head_prompt"], ref["body_prompt"])

    @classmethod
    def IS_CHANGED(cls, video, **kwargs):
        stat = os.stat(video_path(video))
        return stat.st_mtime_ns, stat.st_size

    @classmethod
    def VALIDATE_INPUTS(cls, video):
        try:
            video_path(video)
        except ValueError as error:
            return str(error)
        return True
