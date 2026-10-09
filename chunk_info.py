from comfy_api.latest import io

from .nodes import LoopState, _prepare_chunk, _show_chunk_status


class VKViggleChunkInfo(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleChunkInfo",
            display_name="VK Vigglorious Extract Chunk State",
            category="VK/Viggle",
            has_intermediate_output=True,
            description="Prepare the current chunk's conditioning, initial latents, continuation mask and seed. Display chunk number, source frames, canvas size and preserved anchors. Connect to one SamplerCustomAdvanced; image guides are added separately.",
            hidden=[io.Hidden.unique_id, io.Hidden.dynprompt],
            inputs=[
                LoopState.Input("state", tooltip="Current Loop Start state. Leave resume off. Previous finished chunks supply the continuation anchor."),
                io.Noise.Input("noise", tooltip="RandomNoise with the base seed. Each chunk adds its zero-based index to this seed."),
                io.Vae.Input("vae", optional=True, tooltip="H3 video VAE for five_frame_anchor continuation. Not needed for latent_overlap. This node does not encode image guides."),
            ],
            outputs=[
                io.Conditioning.Output(display_name="conditioning", tooltip="Current driving conditioning without optional image guides. Connect through Attention-Masked Guide if needed, then RefMod wrapper and BasicGuider."),
                io.Latent.Output(display_name="latent", tooltip="Initial H3 video/audio latent with its continuation noise_mask. Connect to the single sampler latent_image."),
                io.Noise.Output(display_name="noise", tooltip="Noise with this chunk's seed. Connect to the single sampler noise input."),
                io.Int.Output(display_name="seed", tooltip="Actual seed for Chunk Finish's checkpoint manifest."),
                io.Int.Output(display_name="frame_count", tooltip="Current chunk frames including overlap and H3 padding. Connect to model preview frame counts."),
            ],
        )

    @classmethod
    def execute(cls, state, noise, vae=None):
        plan, index = state["plan"], state["index"]
        a, b, _, _ = plan["spans"][index]
        height, width = plan["canvas"]
        _show_chunk_status(cls.hidden, f"Chunk {index + 1} / {len(plan['spans'])}\nPreparing continuation...")
        conditioning, latent, chunk_noise, carry = _prepare_chunk(state, noise, vae)
        status = (f"Chunk {index + 1} / {len(plan['spans'])} | frames {a}-{b} ({b - a + 1})\n"
                  f"Canvas {width} x {height} | continuation: {plan.get('continuation', 'latent_overlap')}\n"
                  f"Seed {chunk_noise.seed} | preserved video latents: {carry}\nConditioning ready; sampling follows.")
        _show_chunk_status(cls.hidden, status)
        driving = []
        for tokens, metadata in conditioning:
            metadata = dict(metadata)
            metadata.pop("minimax_keyframes", None)
            metadata.pop("minimax_frame_count", None)
            driving.append([tokens, metadata])
        return io.NodeOutput(driving, latent, chunk_noise,
                             chunk_noise.seed, b - a + 1)
