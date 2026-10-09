import torch

from comfy_api.latest import io

from .nodes import LoopState


GuideSelection = io.Custom("VIGGLE_GUIDE_SELECTION")
ChunkGuides = io.Custom("VIGGLE_CHUNK_GUIDES")


class VKViggleExtractChunkGuides(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleExtractChunkGuides",
            display_name="VK Vigglorious Prepare Chunk Guides",
            category="VK/Viggle",
            description="Extract attention guides and the assigned native image reference for the current chunk as a ComfyUI list. Missing references use the nearest assigned chunk; ties use the earlier chunk. The image and settings lists use the same frame order through the swap subgraph. Connect positions directly to Attention-Masked Guide; No selected images returns an empty list. Reference images bypass SAM3 and are not added as attention guides. Enable reuse_initial_reference when the global swap already supplies Windowed Conditioning with the initial reference.",
            inputs=[
                LoopState.Input("state", tooltip="Current Loop Start state. Uses its actual chunk range, including overlap."),
                io.Image.Input("source_video", tooltip="Loader IMAGE batch used by Windowed Conditioning, in the same frame order."),
                GuideSelection.Input("guide_selection", tooltip="Video Manager guide_selection output with frame positions, swap settings and optional local reference selections made with the Chunk Ref Frame creation toggle or Chunk Ref."),
                io.Boolean.Input("reuse_initial_reference", default=False, optional=True, tooltip="Enable when Video Manager Ref Frame passes through the global swap into Windowed Conditioning ref_image. Reuse that already encoded reference when selected for this chunk, skipping its repeated swap and VAE encoding. Leave off when Windowed receives the unswapped source frame."),
            ],
            outputs=[
                io.Image.Output(display_name="images", is_output_list=True, tooltip="One image per list item, in source frame order, including the nearest chunk reference unless its initial swapped image is reused. Connect through the swap subgraph to Attention-Masked Guide and preserve list order."),
                ChunkGuides.Output(display_name="guide_positions", tooltip="Current chunk positions, canvas, source times, angle names and reference role. A fallback reference may come from outside this chunk. Connect directly to Attention-Masked Guide, around the swap subgraph."),
                io.Image.Output(display_name="reference_images", is_output_list=True, tooltip="One chosen head reference per guide, in image order. Connect to the head-swap reference input. Empty without a reference-angle collection."),
                io.Mask.Output(display_name="reference_masks", is_output_list=True, tooltip="Alpha masks of the chosen reference images, in guide order. These are reference masks, not SAM3 masks of source video or swapped guides."),
                io.Image.Output(display_name="body_reference_images", is_output_list=True, tooltip="One chosen full-body reference per guide, in image order. Connect to the body-swap reference input. Empty without a body-reference collection."),
                io.Boolean.Output(display_name="enable_head_swap", is_output_list=True, tooltip="One boolean per guide. Connect to the swap subgraph Enable head swap input."),
                io.Boolean.Output(display_name="enable_body_swap", is_output_list=True, tooltip="One boolean per guide. Connect to the swap subgraph Enable full body swap input."),
                io.String.Output(display_name="head_additional_prompt", is_output_list=True, tooltip="Resolved Qwen head instructions per guide. Connect to Head additional prompt; these supplement its existing base prompt."),
                io.String.Output(display_name="body_additional_prompt", is_output_list=True, tooltip="Resolved Qwen body instructions per guide. Connect to Full body additional prompt."),
                io.String.Output(display_name="sam_prompt", is_output_list=True, tooltip="Resolved segmentation concept per guide. Connect to Viggle Guide Mask prompt."),
                io.Boolean.Output(display_name="use_mask", is_output_list=True, tooltip="False skips SAM3. Native chunk references always skip SAM3 and use the full swapped image. Connect to Viggle Guide Mask use_mask."),
            ],
        )

    @classmethod
    def execute(cls, state, source_video, guide_selection, reuse_initial_reference=False):
        plan = state["plan"]
        first, last, _, _ = plan["spans"][state["index"]]
        selected = guide_selection["frames"]
        references = guide_selection["references"]
        reference_frames = {}
        for frame, item in selected.items():
            chunk = item.get("reference_chunk")
            if chunk is not None and 1 <= chunk <= len(plan["spans"]):
                ref_first, ref_last, _, _ = plan["spans"][chunk - 1]
                if not ref_first <= frame <= ref_last:
                    continue
                if chunk in reference_frames:
                    raise ValueError(f"VK Viggle: select only one reference image for chunk {chunk}.")
                reference_frames[chunk] = frame
        reference_chunk = min(reference_frames, key=lambda chunk: (abs(chunk - state["index"] - 1), chunk)) if reference_frames else None
        reference_frame = reference_frames.get(reference_chunk)
        reuse_reference = reference_frame is not None and reuse_initial_reference and reference_frame == guide_selection.get("initial_reference_frame")
        reference_sources = set(reference_frames.values())
        frames = sorted(frame for frame in selected if first <= frame <= last and frame < source_video.shape[0]
                        and frame not in reference_sources)
        if reference_frame is not None and not reuse_reference:
            frames = sorted(set(frames) | {reference_frame})
        positions = {"source_frames": frames, "local_frames": [frame - first for frame in frames], "canvas": plan["canvas"]}
        if reference_frame is not None:
            positions["reference_chunk"] = reference_chunk
            positions["chunk"] = state["index"] + 1
            if reuse_reference:
                positions["reused_reference_frame"] = reference_frame
            else:
                positions["reference_index"] = frames.index(reference_frame)
        positions["video_seconds"] = [selected[frame]["seconds"] for frame in frames]
        modes = [selected[frame].get("swap_mode", "head") for frame in frames]
        angles = [references.get(selected[frame]["angle_id"]) for frame in frames] if references else []
        body_references = guide_selection.get("body_references", {})
        bodies = [body_references.get(selected[frame]["body_angle_id"]) for frame in frames] if body_references else []
        positions["angle_names"] = [" · ".join(([f"Head: {angles[index]['name']}"] if angles and angles[index] else []) + ([f"Full body: {bodies[index]['name']}"] if bodies and bodies[index] else [])) for index in range(len(frames))] if angles or bodies else []
        positions["mask_modes"] = [selected[frame].get("mask_mode", "sam3") for frame in frames]
        if "reference_index" in positions:
            positions["mask_modes"][positions["reference_index"]] = "none"
        images = [source_video[frame:frame + 1].clone() for frame in frames]
        head_images = [angle["image"] if angle and angle["image"] is not None else images[index] for index, angle in enumerate(angles)]
        head_masks = [angle["mask"] if angle and angle["mask"] is not None else torch.zeros_like(images[index][..., 0]) for index, angle in enumerate(angles)]
        body_images = [body["image"] if body and body["image"] is not None else images[index] for index, body in enumerate(bodies)]
        return io.NodeOutput(images, positions, head_images, head_masks, body_images,
                             [mode != "body" for mode in modes], [mode != "head" for mode in modes],
                             [selected[frame].get("head_prompt", "") for frame in frames],
                             [selected[frame].get("body_prompt", "") for frame in frames],
                             [selected[frame].get("sam_prompt", "head, hair") for frame in frames],
                             [mode != "none" for mode in positions["mask_modes"]])


class VKViggleExtractChunkFrames(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleExtractChunkFrames",
            display_name="VK Vigglorious Extract Chunk Frames",
            category="VK/Viggle",
            description="Extract the current chunk, including overlap and repeated final-frame padding, for source-mask tracking.",
            inputs=[
                LoopState.Input("state", tooltip="Current Loop Start state. Uses the same inclusive frame range as driving conditioning."),
                io.Image.Input("source_video", tooltip="Same loader IMAGE batch connected to Windowed Conditioning. Preserve its frame order."),
            ],
            outputs=[io.Image.Output(display_name="images", tooltip="Current chunk IMAGE batch for SAM3 Video Track. Short final chunks repeat the last source frame.")],
        )

    @classmethod
    def execute(cls, state, source_video):
        first, last, _, _ = state["plan"]["spans"][state["index"]]
        frames = source_video[first:min(last + 1, source_video.shape[0])].clone()
        missing = last - first + 1 - frames.shape[0]
        if missing:
            tail = source_video[-1:].expand(missing, -1, -1, -1)
            frames = torch.cat((frames, tail), dim=0)
        return io.NodeOutput(frames)
