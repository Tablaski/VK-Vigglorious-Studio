import json
import math

import comfy.utils

from comfy_api.latest import io, ui
from comfy_extras.nodes_minimax_h3 import _resize

from .guide_attention import STRENGTH_KEY, MASK_KEY, SOURCE_MASK_KEY, OUTSIDE_KEY, MASK_BOUNDARIES_KEY
from .nodes import _guide, _guide_preview, _show_chunk_status
from .chunk_guides import ChunkGuides
from .refmod_scheduler import sigma_intervals, restrict_conditioning


def guide_schedule(sigmas, steps, strengths, enabled_steps):
    values = json.loads(strengths)
    if not isinstance(values, list) or len(values) != steps or any(
        isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 for value in values
    ):
        raise ValueError("VK Guide Schedule: provide one finite nonnegative strength per step.")
    enabled = json.loads(enabled_steps)
    if enabled == []:
        enabled = [True] * steps
    if not isinstance(enabled, list) or len(enabled) != steps or any(type(value) is not bool for value in enabled):
        raise ValueError("VK Guide Schedule: provide one ON/OFF boolean per step.")
    intervals = sigma_intervals(sigmas, steps)
    groups = []
    first = 0
    for index, value in enumerate(values):
        if index + 1 < steps and (enabled[index], value) == (enabled[index + 1], values[index + 1]):
            continue
        groups.append((intervals[first][0], intervals[index][1], value, enabled[index]))
        first = index + 1
    return groups


def replace_reference(conditioning, image, vae, canvas):
    height, width = image.shape[1:3]
    scale = min(canvas) / min(height, width)
    height, width = max(32, round(height * scale / 32) * 32), max(32, round(width * scale / 32) * 32)
    pixels = image[:1, ..., :3]
    if pixels.shape[1:3] != (height, width):
        pixels = _resize(pixels, width, height, "disabled")
    reference = {"kind": "image", "latent_h": height // 16, "latent_w": width // 16, "latent": vae.encode(pixels)}
    result = []
    for tokens, metadata in conditioning:
        refs = list(metadata.get("minimax_refs", []))
        if len(refs) < 2 or refs[0].get("kind") != "video" or refs[1].get("kind") != "image":
            raise ValueError("VK Viggle: chunk references require Windowed Conditioning before RefMod Apply.")
        refs[1] = {**refs[1], **reference}
        result.append([tokens, {**metadata, "minimax_refs": refs}])
    return result, pixels


class VKAttentionMaskedGuide(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKAttentionMaskedGuide",
            display_name="VK Vigglorious Attention-Masked Guide",
            category="VK/Viggle",
            has_intermediate_output=True,
            is_input_list=True,
            description="Encode swapped images for the current chunk. A reference-role image replaces the native Viggle image reference; other images become guides at their selected positions. Preview used guides with a red mask overlay, loaded frame number and source-video seconds, matching the loader gallery. Preserve image and mask order through the swap subgraph. Schedule guide attention factors by sigma step. Masks belong to swapped images; source masks are experimental. Requires Patch Guide Attention on MODEL. Guide switches, factors and masks do not affect the native image reference. All steps OFF skips swap/VAE work only when no reference is assigned.",
            hidden=[io.Hidden.unique_id, io.Hidden.dynprompt],
            inputs=[
                io.Conditioning.Input("conditioning", tooltip="Driving conditioning from Extract Chunk State. Existing guides and RefMods are preserved."),
                ChunkGuides.Input("guide_positions", tooltip="Connect Prepare Chunk Guides guide_positions directly. Supplies local positions and target resolution for the current chunk."),
                io.Float.Input("strength", default=1.0, min=0.0, max=10.0, step=0.01, tooltip="Guide attention factor when sigmas is disconnected. 1 is native, below 1 weakens direct guide attention, above 1 strengthens it; 0 bypasses guides. Connected sigmas use per-step factors instead."),
                io.Combo.Input("mask_boundaries", options=["soft", "hard"], default="soft", tooltip="Soft preserves grayscale mask weights; hard uses binary token boundaries. Applies to guide and source masks. Without a mask, its full image or video region is available."),
                io.Image.Input("images", optional=True, lazy=True, tooltip="Swapped ComfyUI image list for this chunk, one single-image item per selected position in the same order. Absent bypasses guides and reference replacement."),
                io.Mask.Input("masks", optional=True, lazy=True, tooltip="Masks segmented on the swapped guide images, including their new hair and silhouette. Supply one single-mask list item per image, in the same order, or one shared mask. White selects guide regions; black uses outside_attention. Disconnected uses full guide images. Preview: red."),
                io.Vae.Input("vae", optional=True, lazy=True, tooltip="H3 video VAE for encoding each guide at the chunk resolution. Required for a chunk reference or active attention guides."),
                io.Sigmas.Input("sigmas", optional=True, tooltip="Connect the same complete descending SIGMAS as SamplerCustomAdvanced. Enables the per-step ON/OFF and strength sliders. Disconnected uses constant strength."),
                io.Int.Input("steps", default=3, min=1, max=10000, tooltip="Number of transitions in the connected sigma schedule. Creates one ON/OFF switch and force slider per step. Must equal the sampler's sigma count minus one."),
                io.String.Input("strengths", default="[0.5,2,2]", tooltip="Guide attention factors saved by the per-step sliders. Defaults: step 1 = 0.5, following steps = 2. Used with sigmas connected. 1 is native; 0 blocks direct access. These are not identity percentages."),
                io.String.Input("enabled_steps", default="[]", tooltip="JSON booleans saved by per-step switches; empty means all ON. OFF removes this node's guides from that sigma interval. ON at factor 0 retains guide tokens but blocks direct access."),
                io.Mask.Input("source_masks", optional=True, lazy=True, tooltip="Experimental: one MASK batch for every original video frame of the current chunk, including overlap and final-frame padding. Restricts which video regions can attend to guides; may reduce identity transfer and slow sampling. Does not supply guide masks. Disconnected leaves video queries unrestricted. Preview: green at each guide frame; red/green overlap is yellow."),
                io.Float.Input("outside_attention", default=0.0, min=0.0, max=10.0, step=0.01, tooltip="Attention multiplier outside either mask: 0 blocks direct guide access, 1 leaves it unchanged. Soft interpolates from this value to 1 inside. Guide strength still applies. Indirect influence through other tokens remains possible."),
            ],
            outputs=[io.Conditioning.Output(display_name="conditioning", tooltip="Conditioning with active image guides. Connect to the RefMod wrapper, then BasicGuider. The assigned image reference remains active with guides OFF. Without a reference or active guides, returns the original conditioning.")],
        )

    @classmethod
    def check_lazy_status(cls, guide_positions, strength=(1.0,),
                          sigmas=None, steps=(3,), strengths=("[0.5,2,2]",), enabled_steps=("[]",),
                          **kwargs):
        if not guide_positions[0]["local_frames"]:
            return []
        has_reference = "reference_index" in guide_positions[0]
        guides_active = any(on for _, _, _, on in guide_schedule(sigmas[0], steps[0], strengths[0], enabled_steps[0])) if sigmas is not None else strength[0] > 0
        if not guides_active and not has_reference:
            return []
        if "images" in kwargs and (kwargs["images"] is None or any(image is None for image in kwargs["images"])):
            return ["images"]
        if not kwargs.get("images"):
            return []
        needed = ["masks", "vae", "source_masks"]
        if has_reference and (not guides_active or len(guide_positions[0]["local_frames"]) == 1):
            needed = ["vae"]
        if "masks" in needed and guide_positions[0].get("mask_modes") and all(mode == "none" for mode in guide_positions[0]["mask_modes"]):
            needed.remove("masks")
        return [name for name in needed if name in kwargs and
                (kwargs[name] is None or any(value is None for value in kwargs[name]))]

    @classmethod
    def execute(cls, conditioning, guide_positions, strength=(1.0,), mask_boundaries=("soft",),
                images=None, masks=None, vae=None, sigmas=None, steps=(3,),
                strengths=("[0.5,2,2]",), enabled_steps=("[]",), source_masks=None,
                outside_attention=(0.0,)):
        conditioning, guide_positions = conditioning[0], guide_positions[0]
        strength, mask_boundaries = strength[0], mask_boundaries[0]
        reused_reference = guide_positions.get("reused_reference_frame")
        reference_status = (f"Using initial swapped reference: loaded frame {reused_reference + 1}, from chunk {guide_positions['reference_chunk']}."
                            if reused_reference is not None else "")
        if not guide_positions["local_frames"]:
            _show_chunk_status(cls.hidden, reference_status or "No guide images for this chunk.")
            return io.NodeOutput(conditioning, ui={"images": []})
        schedule = guide_schedule(sigmas[0], steps[0], strengths[0], enabled_steps[0]) if sigmas is not None else [(None, None, strength, True)]
        reference_index = guide_positions.get("reference_index")
        guides_active = any(on for _, _, _, on in schedule) and (sigmas is not None or strength > 0)
        if (not guides_active and reference_index is None) or not images or images[0] is None:
            _show_chunk_status(cls.hidden, reference_status or "No active guide images for this chunk.")
            return io.NodeOutput(conditioning, ui={"images": []})
        masks = masks if masks and masks[0] is not None else None
        source_masks = source_masks if source_masks and source_masks[0] is not None else None
        frames = guide_positions["local_frames"]
        if len(images) != len(frames) or any(image.shape[0] != 1 for image in images):
            raise ValueError("VK Viggle: swapped image count must match guide positions; preserve batch count and order through the swap.")
        if masks is not None and (len(masks) not in (1, len(frames)) or any(mask.shape[0] != 1 for mask in masks)):
            raise ValueError("VK Viggle: supply one mask per guide image or one shared mask.")
        if vae is None:
            raise ValueError("VK Viggle: connect the H3 video VAE to encode guide images.")
        height, width = guide_positions["canvas"]
        source_mask = None
        if source_masks is not None and guides_active and len(frames) > (reference_index is not None):
            if len(source_masks) != 1:
                raise ValueError("VK Viggle: source_masks must be one batch for the whole current chunk, not a guide list.")
            source_mask = comfy.utils.common_upscale(source_masks[0][:, None].float(), width, height, "bilinear", "disabled")[:, 0].clamp(0, 1)
        guides, previews, labels = [], [], []
        if reference_status:
            labels.append(reference_status)
        if reference_index is not None:
            conditioning, pixels = replace_reference(conditioning, images[reference_index], vae[0], (height, width))
            source = guide_positions["source_frames"][reference_index] + 1
            seconds = guide_positions["video_seconds"][reference_index]
            labels.append(f"Reference: loaded frame {source}, {seconds:.3f} s, from chunk {guide_positions['reference_chunk']}")
            previews.extend(ui.PreviewImage(_guide_preview(pixels, None, source, seconds, "Reference")).values)
        for index, target in enumerate(frames):
            if index == reference_index or not guides_active:
                continue
            image = images[index]
            mask = None if masks is None else masks[min(index, len(masks) - 1)]
            if guide_positions.get("mask_modes", [])[index:index + 1] == ["none"]:
                mask = None
            guide = _guide(image, mask, vae[0], target, width, height, mask_boundaries)
            guide[OUTSIDE_KEY] = outside_attention[0]
            guide[MASK_BOUNDARIES_KEY] = mask_boundaries
            if source_mask is not None:
                guide[SOURCE_MASK_KEY] = source_mask
            guides.append(guide)
            source, seconds = guide_positions["source_frames"][index] + 1, guide_positions["video_seconds"][index]
            names = guide_positions.get("angle_names", [])
            angle = f"{names[index]} · " if names else ""
            labels.append(f"{angle}Guide: loaded frame {source}, {seconds:.3f} s, chunk frame {target + 1}")
            pixels = _resize(image[:1, ..., :3], width, height, "center")
            source_preview = None if source_mask is None else source_mask[target:target + 1]
            previews.extend(ui.PreviewImage(_guide_preview(pixels, guide.get(MASK_KEY), source, seconds, names[index] if names else "", source_preview)).values)
        settings = ", ".join(f"{value:g}" if on else "OFF" for _, _, value, on in schedule)
        _show_chunk_status(cls.hidden, "\n".join(labels) + f"\nGuides attention factor: {settings} | boundaries: {mask_boundaries}")
        result = []
        for start, end, value, on in schedule:
            active = []
            if on:
                for guide in guides:
                    item = dict(guide)
                    item[STRENGTH_KEY] = value
                    active.append(item)
            current = []
            for tokens, metadata in conditioning:
                item = dict(metadata)
                item["minimax_keyframes"] = list(item.get("minimax_keyframes", [])) + active
                current.append([tokens, item])
            if start is None:
                result = current
            else:
                result = restrict_conditioning(current, start, end, result)
        return io.NodeOutput(result, ui={"images": previews})
