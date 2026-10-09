import torch

from comfy_api.latest import io
from comfy_extras.nodes_sam3 import SAM3_Detect
from nodes import CLIPTextEncode


class VKViggleGuideMask(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleGuideMask",
            display_name="VK Vigglorious Guide Mask",
            category="VK/Viggle",
            description="Segment each swapped guide with native SAM3 and its resolved prompt. Disabling use_mask skips SAM3 and returns a white mask for the whole image. Connect the same Prepare Chunk Guides guide_positions to Attention-Masked Guide so disabled masks have no overlay or restriction.",
            inputs=[
                io.Image.Input("image", tooltip="Swapped guide image list from the Qwen swap subgraph. Keep the order from Prepare Chunk Guides."),
                io.String.Input("prompt", default="head, hair", tooltip="SAM3 concept from Prepare Chunk Guides sam_prompt. Use short object or region names. Ignored when use_mask is false."),
                io.Boolean.Input("use_mask", default=True, tooltip="Connect Prepare Chunk Guides use_mask. False uses the whole guide and does not load or run SAM3."),
                io.Model.Input("model", optional=True, lazy=True, tooltip="SAM3 model from CheckpointLoaderSimple. Required only for guides with use_mask enabled."),
                io.Clip.Input("clip", optional=True, lazy=True, tooltip="SAM3 CLIP from the same checkpoint loader. Encodes each guide's own text. Required only with use_mask enabled."),
                io.Float.Input("threshold", default=0.5, min=0.0, max=1.0, step=0.01, tooltip="Minimum SAM3 detection probability. Lower detects more candidates; higher rejects more. Start with 0.5."),
                io.Int.Input("refine_iterations", default=2, min=0, max=5, tooltip="Native SAM decoder refinement passes. 0 keeps coarse detector masks; start with 2."),
            ],
            outputs=[io.Mask.Output(display_name="mask", tooltip="One mask per swapped guide. White selects guide regions. Connect through the existing Grow Mask With Blur node to Attention-Masked Guide masks.")],
        )

    @classmethod
    def check_lazy_status(cls, use_mask=True, model=None, clip=None, **kwargs):
        return [name for name, value in (("model", model), ("clip", clip)) if value is None] if use_mask else []

    @classmethod
    def execute(cls, image, prompt="head, hair", use_mask=True, model=None, clip=None, threshold=0.5, refine_iterations=2):
        if not use_mask:
            return io.NodeOutput(torch.ones_like(image[..., 0]))
        if model is None or clip is None:
            raise ValueError("VK Viggle: connect the SAM3 model and CLIP for masked guides.")
        conditioning = CLIPTextEncode().encode(clip, prompt)[0]
        masks = SAM3_Detect.execute(model, image, conditioning=conditioning, threshold=threshold,
                                   refine_iterations=refine_iterations, individual_masks=False).result[0]
        return io.NodeOutput(masks)
