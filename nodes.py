import copy
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

import safetensors.torch
import torch
from PIL import Image, ImageDraw, ImageFont

import folder_paths
import comfy.model_management
from comfy.nested_tensor import NestedTensor
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import _resize
from comfy_execution.utils import get_executing_context
from server import PromptServer
import comfy.utils

from .guide_attention import MASK_KEY, MASK_BOUNDARIES_KEY, VKVigglePatchGuideAttention


LoopState = io.Custom("VIGGLE_LOOP_STATE")


def _show_chunk_status(hidden, text):
    context = get_executing_context()
    server = getattr(PromptServer, "instance", None)
    if hidden is None or context is None or server is None or server.client_id is None:
        return
    node_id = hidden.dynprompt.get_display_node_id(hidden.unique_id)
    server.send_sync("vk.viggle_chunk_status", {"node_id": node_id, "text": text, "prompt_id": context.prompt_id}, server.client_id)


def _guide(image, mask, vae, frame_index, width, height, mask_boundaries="soft"):
    pixels = image[:1, ..., :3]
    guide = {"resolved_frame_index": frame_index, "latent": vae.encode(_resize(pixels, width, height, "center"))}
    if mask is not None:
        aligned = comfy.utils.common_upscale(mask[:1, None].float(), pixels.shape[2], pixels.shape[1], "bilinear", "disabled")
        guide[MASK_KEY] = comfy.utils.common_upscale(aligned, width, height, "bilinear", "center")[:, 0].clamp(0, 1)
        guide[MASK_BOUNDARIES_KEY] = mask_boundaries
    return guide


def _guide_preview(image, mask, frame_index, seconds, angle_name="", source_mask=None):
    preview = image[:1, ..., :3].detach().to(device="cpu", copy=True)
    height, width = preview.shape[1:3]
    if mask is not None or source_mask is not None:
        colors = preview.new_zeros((1, height, width, 3))
        for channel, overlay in ((0, mask), (1, source_mask)):
            if overlay is not None:
                aligned = comfy.utils.common_upscale(overlay[:1, None].detach().to(preview), width, height, "bilinear", "disabled")
                colors[..., channel] = aligned[:, 0].clamp(0, 1)
        alpha = colors.amax(dim=-1, keepdim=True)
        tint = colors / alpha.clamp_min(1e-6)
        preview = torch.lerp(preview, tint, alpha * 0.4)
    text = f"{angle_name} · " if angle_name else ""
    text += f"Frame {frame_index} · {seconds:.3f} s"
    font = ImageFont.load_default(size=max(1, min(height, width) // 24))
    left, top, right, bottom = font.getbbox(text)
    padding = max(1, height // 100)
    badge = Image.new("RGB", (min(width, right - left + 2 * padding), min(height, bottom - top + 2 * padding)))
    ImageDraw.Draw(badge).text((padding - left, padding - top), text, font=font, fill="white")
    pixels = torch.frombuffer(bytearray(badge.tobytes()), dtype=torch.uint8).reshape(badge.height, badge.width, 3)
    pixels = pixels.to(dtype=preview.dtype).div_(255)
    x, y = max(0, width - badge.width - padding), max(0, height - badge.height - padding)
    preview[:, y:y + badge.height, x:x + badge.width] = pixels
    return preview


def _run_directory(run_name):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", run_name) or re.fullmatch(r"(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])", run_name):
        raise ValueError("VK Viggle: run_name must be 1–64 letters, digits, underscores or hyphens, and not a reserved Windows name.")
    root = Path(folder_paths.get_output_directory()).resolve()
    directory = (root / "viggle_chunks" / run_name).resolve()
    if not directory.is_relative_to(root):
        raise ValueError("VK Viggle: checkpoint directory must remain inside ComfyUI output.")
    return directory


def _atomic_write(path, writer):
    fd, temporary = tempfile.mkstemp(prefix=".vk-viggle-", suffix=".tmp", dir=path.parent)
    os.close(fd)
    try:
        writer(temporary)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _prepare_chunk(state, noise, vae):
    if state["resume"]:
        raise ValueError("VK Viggle: turn off resume on Loop Start; external samplers cannot skip saved chunks.")
    plan, index = state["plan"], state["index"]
    a, b, start, count = plan["spans"][index]
    height, width = plan["canvas"]
    continuation = plan.get("continuation", "latent_overlap")
    if continuation == "five_frame_anchor" and vae is None:
        raise ValueError("VK Viggle: connect the H3 video VAE for five_frame_anchor.")
    device = comfy.model_management.intermediate_device()
    video = torch.zeros((1, 24, count, height // 16, width // 16), device=device)
    audio_start, audio_end = round(a / 24 * 40), round((b + 1) / 24 * 40)
    audio = torch.zeros((1, 32, 2, audio_end - audio_start), device=device)
    previous, carry = state["previous"], 0
    if previous is not None:
        pa, pb, previous_start, previous_count = previous["span"]
        if continuation == "five_frame_anchor":
            frames = vae.decode(previous["video"].to(device))
            if frames.ndim == 5:
                frames = frames.reshape(-1, *frames.shape[-3:])
            anchor_frames = frames[a - pa:a - pa + 5].clone()
            del frames
            if anchor_frames.shape[0] != 5 or not torch.isfinite(anchor_frames).all():
                raise ValueError("VK Viggle: continuation requires five finite decoded anchor frames.")
            anchor = vae.encode(anchor_frames)
            if anchor.shape[2] != 2 or not torch.isfinite(anchor).all():
                raise ValueError("VK Viggle: H3 VAE must encode the five-frame anchor into two finite temporal latents.")
            carry = anchor.shape[2]
            video[:, :, :carry] = anchor.to(video)
        else:
            carry = max(0, previous_start + previous_count - start)
            if carry:
                offset = start - previous_start
                video[:, :, :carry] = previous["video"][:, :, offset:offset + carry].to(video)
            audio_overlap = max(0, round((pb + 1) / 24 * 40) - audio_start)
            audio_offset = audio_start - round(pa / 24 * 40)
            if audio_overlap:
                audio[..., :audio_overlap] = previous["audio"][..., audio_offset:audio_offset + audio_overlap].to(audio)
    latent = {"samples": NestedTensor((video, audio))}
    if carry:
        mask_video = torch.ones((1, 1, count, height // 16, width // 16), device=device)
        mask_audio = torch.ones((1, 1, 1, audio.shape[-1]), device=device)
        mask_video[:, :, :carry] = 0
        latent["noise_mask"] = NestedTensor((mask_video, mask_audio))
    chunk_noise = copy.copy(noise)
    chunk_noise.seed = (int(noise.seed) + index) % (1 << 64)
    conditioning = plan["conds"][index]
    return conditioning, latent, chunk_noise, carry


class VKViggleChunkFinish(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleChunkFinish",
            display_name="VK Vigglorious Chunk Finish",
            category="VK/Viggle",
            description="Checkpoint the final video/audio latent and advance Viggle loop state. Saved latents remain readable by Viggle Assemble Chunk Latents after interruption. Every queued run samples again.",
            inputs=[
                LoopState.Input("state", tooltip="Connect the same Viggle Chunk Loop Start state used by Extract Chunk State."),
                io.Latent.Input("samples", tooltip="The final sampler output after completing the schedule at sigma 0. Must contain the H3 video/audio pair."),
                io.Int.Input("seed", force_input=True, tooltip="Connect the seed output of Extract Chunk State; stored in the checkpoint manifest."),
            ],
            outputs=[
                LoopState.Output(display_name="chunk", tooltip="Advanced state and final latent for the next chunk. Connect to Viggle Chunk Loop End chunk."),
                io.Latent.Output(display_name="video_latent", tooltip="Video-only copy for per-chunk VAE Decode. Connect decoded images to Loop End images."),
                io.String.Output(display_name="filename_prefix", tooltip="Unique relative prefix for saving this chunk preview. Connect to the per-chunk Video Combine filename_prefix."),
            ],
        )

    @classmethod
    def execute(cls, state, samples, seed):
        if state["resume"]:
            raise ValueError("VK Viggle: turn off resume on Loop Start; external samplers cannot skip saved chunks.")
        pair = samples["samples"]
        if not isinstance(pair, NestedTensor) or len(pair.unbind()) != 2:
            raise ValueError("VK Viggle: connect the final sampler's H3 video/audio LATENT output to Finish.")
        video, audio = pair.unbind()
        plan, index = state["plan"], state["index"]
        a, b, start, count = plan["spans"][index]
        height, width = plan["canvas"]
        if tuple(video.shape) != (1, 24, count, height // 16, width // 16) or tuple(audio.shape) != (1, 32, 2, round((b + 1) / 24 * 40) - round(a / 24 * 40)):
            raise ValueError("VK Viggle: Sampler latent dimensions do not match the current chunk.")
        if not torch.isfinite(video).all() or not torch.isfinite(audio).all():
            raise ValueError("VK Viggle: Sampler produced NaN/Inf; chunk was not checkpointed or carried forward.")
        video, audio = video.detach().to("cpu", copy=True).contiguous(), audio.detach().to("cpu", copy=True).contiguous()
        predecessor = state["entries"][-1]["key"] if index else ""
        digest = hashlib.sha256(json.dumps((1, predecessor, plan["canvas"], plan.get("continuation", "latent_overlap"), (a, b, start, count), int(seed))).encode())
        for tensor in (video, audio):
            digest.update(str(tensor.dtype).encode())
            for slab in tensor[0]:
                digest.update(memoryview(slab.contiguous().view(torch.uint8).numpy()).cast("B"))
        key = digest.hexdigest()
        entry = {"file": f"chunk_{index + 1:04}_{key[:16]}.latent", "key": key,
                 "previous_key": predecessor, "span": [a, b, start, count], "seed": int(seed)}
        directory = _run_directory(state["run_name"])
        directory.mkdir(parents=True, exist_ok=True)
        path = (directory / entry["file"]).resolve()
        if not path.is_relative_to(directory):
            raise ValueError("VK Viggle: checkpoint path escapes its run directory.")
        metadata = {"viggle": json.dumps({"version": 1, "entry": entry, "canvas": list(plan["canvas"])})}
        tensors = {"latent_tensor": video, "audio": audio, "latent_format_version_0": torch.empty(0)}
        _atomic_write(path, lambda temporary: safetensors.torch.save_file(tensors, temporary, metadata=metadata))
        entries = state["entries"] + [entry]
        manifest = {"version": 1, "run_name": state["run_name"], "canvas": list(plan["canvas"]),
                    "total_frames": plan["total_frames"], "continuation": plan.get("continuation", "latent_overlap"), "entries": entries}
        _atomic_write(directory / "manifest.json", lambda temporary: Path(temporary).write_text(json.dumps(manifest, indent=2), encoding="utf-8"))
        chunk = {**state, "index": index + 1, "entries": entries,
                 "previous": {"span": entry["span"], "video": video, "audio": audio}}
        return io.NodeOutput(chunk, {"samples": video.clone()}, f"viggle_chunks/{state['run_name']}/preview_{index + 1:04}_{key[:8]}")


NODE_CLASS_MAPPINGS = {cls.__name__: cls for cls in (VKViggleChunkFinish, VKVigglePatchGuideAttention)}
NODE_DISPLAY_NAME_MAPPINGS = {"VKViggleChunkFinish": "VK Vigglorious Chunk Finish",
                              "VKVigglePatchGuideAttention": "VK Vigglorious Patch Guide Attention"}
