import logging
import math

import torch
import torch.nn.functional as F

from comfy.ldm.minimax.model import MiniMaxH3Model, FRAME_PER_TOKEN
from comfy.ldm.modules.attention import optimized_attention
from comfy.patcher_extension import WrappersMP
from comfy_api.latest import io

from .refmod_scheduler import REFMOD_ATTENTION_KEY, REFMOD_RESIDUAL_KEY


SOURCE_MASK_KEY = "vk_chunk_source_mask"
OUTSIDE_KEY = "vk_chunk_mask_outside_attention"
MASK_KEY = "vk_chunk_guide_mask"
MASK_BOUNDARIES_KEY = "vk_chunk_guide_mask_boundaries"
STRENGTH_KEY = "vk_chunk_guide_strength"
PATCH_KEY = "vk_chunk_guide_attention"


def mask_tokens(mask, height, width, hard):
    mask = mask[:, None].to(dtype=torch.float32).clamp(0, 1)
    if hard:
        mask = F.adaptive_max_pool2d(mask, (height, width))
        return (F.max_pool2d(mask, 2) > 0.5).to(torch.float32)[:, 0]
    mask = F.interpolate(mask, size=(height, width), mode="area")
    return F.avg_pool2d(mask, 2)[:, 0]


def source_token_weights(mask, temporal, height, width, hard, outside):
    counts = [FRAME_PER_TOKEN[index % len(FRAME_PER_TOKEN)] for index in range(temporal)]
    if mask.shape[0] != sum(counts):
        raise ValueError(f"VK Viggle: source mask has {mask.shape[0]} frames; current H3 chunk needs {sum(counts)} including overlap and padding.")
    spatial = mask_tokens(mask, height, width, hard)
    frames, first = [], 0
    for count in counts:
        group = spatial[first:first + count]
        frames.append(group.amax(dim=0) if hard else group.mean(dim=0))
        first += count
    return outside + (1 - outside) * torch.stack(frames).flatten()


class GuideAttentionForward:
    def __init__(self, guides, refs=()):
        self.guides = guides
        self.refs = refs
        self.layout = None
        self.has_bias = any(guide.get(STRENGTH_KEY, 1.0) != 1.0 or MASK_KEY in guide or SOURCE_MASK_KEY in guide for guide in guides) or any(
            ref.get(REFMOD_ATTENTION_KEY, 1.0) != 1.0 for ref in refs)
        self.residual_groups = {}

    def prepare(self, layout, device):
        if self.layout is not None:
            return
        segments = [(a, b) for a, b, kind in layout.segments if kind == "cond"]
        if len(segments) != len(self.guides):
            raise ValueError("VK Viggle: guide tokens do not match the native H3 layout.")
        self.video_start, self.video_stop = next((a, b) for a, b, kind in layout.segments if kind == "video")
        _, video_t, height, width, _ = layout.signature
        self.source_weights = {}
        source_cache = {}
        self.bias = torch.zeros((1, 1, 1, layout.seq_len), device=device, dtype=torch.float32)
        for guide, (start, stop) in zip(self.guides, segments):
            mask = guide.get(MASK_KEY)
            strength = guide.get(STRENGTH_KEY, 1.0)
            if mask is None:
                weights = torch.full((stop - start,), strength, device=device)
            else:
                temporal, h, w = guide["latent"].shape[2:]
                if (h, w) != (height, width) or stop - start != temporal * (height // 2) * (width // 2):
                    raise ValueError("VK Viggle: masked guides require full native H3 guide tokens.")
                mask = mask_tokens(mask[:1].to(device=device), h, w, guide.get(MASK_BOUNDARIES_KEY, "soft") == "hard")
                outside = guide.get(OUTSIDE_KEY, 0.0)
                weights = (outside + (1 - outside) * mask).expand(temporal, -1, -1).flatten() * strength
            source = guide.get(SOURCE_MASK_KEY)
            if source is not None:
                hard = guide.get(MASK_BOUNDARIES_KEY, "soft") == "hard"
                outside = guide.get(OUTSIDE_KEY, 0.0)
                key = (id(source), hard, outside)
                if key not in source_cache:
                    source_cache[key] = source_token_weights(source.to(device=device), video_t, height, width, hard, outside)
                self.source_weights[(start, stop)] = source_cache[key]
            self.bias[..., start:stop] = weights.log()
        ref_segments = [(a, b, kind) for a, b, kind in layout.segments if kind in ("ref_img", "ref_audio")]
        segment_index = 0
        for ref in self.refs:
            kinds = []
            if ref["kind"] in ("audio", "video", "video_audio") and ref.get("ref_audio_t", 0) > 0:
                kinds.append("ref_audio")
            if ref["kind"] in ("image", "video", "video_audio"):
                kinds.append("ref_img")
            for kind in kinds:
                start, stop, actual = ref_segments[segment_index]
                if actual != kind:
                    raise ValueError("VK Viggle: RefMod tokens do not match the native H3 layout.")
                segment_index += 1
                strength = ref.get(REFMOD_ATTENTION_KEY, 1.0)
                self.bias[..., start:stop] = math.log(strength) if strength > 0 else -torch.inf
                residual = ref.get(REFMOD_RESIDUAL_KEY)
                if kind == "ref_img" and residual is not None and residual[0] > 0:
                    self.residual_groups.setdefault(tuple(residual), []).append((start, stop))
        if segment_index != len(ref_segments):
            raise ValueError("VK Viggle: reference count does not match the native H3 layout.")
        self.query_chunk = max(1, min(256, 4194304 // layout.seq_len))
        self.layout = layout

    def attention(self, backend, q, k, v, heads, mask=None, block_index=0, residual_backend=None, **kwargs):
        if not kwargs.get("skip_reshape", False) or q.shape[-2] != self.layout.seq_len or k.shape[-2] != self.layout.seq_len:
            raise ValueError("VK Viggle: guide attention requires the native packed H3 sequence.")
        options = dict(kwargs)
        options["transformer_options"] = {name: value for name, value in kwargs.get("transformer_options", {}).items()
                                          if name not in ("optimized_attention_override", "minimax_h3_layout")}

        def run(start, stop, bias=None):
            if mask is not None:
                existing = mask if mask.shape[-2] == 1 else mask[..., start:stop, :]
                if existing.dtype == torch.bool:
                    existing = torch.zeros_like(existing, dtype=q.dtype).masked_fill(~existing, -torch.inf)
                bias = existing if bias is None else existing + bias
            return backend(q[..., start:stop, :], k, v, heads, mask=bias, **options)

        if self.has_bias:
            outputs = []
            if self.video_start:
                outputs.append(run(0, self.video_start))
            if self.source_weights:
                for start in range(self.video_start, self.video_stop, self.query_chunk):
                    stop = min(start + self.query_chunk, self.video_stop)
                    bias = self.bias.to(q.dtype).expand(1, 1, stop - start, -1).clone()
                    for (a, b), weights in self.source_weights.items():
                        local = weights[start - self.video_start:stop - self.video_start]
                        bias[..., a:b] += local.log().to(q.dtype)[None, None, :, None]
                    outputs.append(run(start, stop, bias))
            else:
                outputs.append(run(self.video_start, self.video_stop, self.bias.to(q.dtype)))
            out = torch.cat(outputs, dim=-2 if kwargs.get("skip_output_reshape", False) else 1)
        else:
            out = backend(q, k, v, heads, mask=mask, **options)
        for (strength, first, last), spans in self.residual_groups.items():
            if block_index < first or last != 0 and block_index >= last:
                continue
            if len(spans) == 1:
                a, b = spans[0]
                ref_k, ref_v = k[..., a:b, :], v[..., a:b, :]
            else:
                ref_k = torch.cat([k[..., a:b, :] for a, b in spans], dim=-2)
                ref_v = torch.cat([v[..., a:b, :] for a, b in spans], dim=-2)
            ref_mask = None
            if mask is not None:
                video_mask = mask if mask.shape[-2] == 1 else mask[..., self.video_start:self.video_stop, :]
                ref_mask = torch.cat([video_mask[..., a:b] for a, b in spans], dim=-1)
            residual = (backend if residual_backend is None else residual_backend)(
                q[..., self.video_start:self.video_stop, :], ref_k, ref_v, heads, mask=ref_mask, **options)
            if kwargs.get("skip_output_reshape", False):
                out[..., self.video_start:self.video_stop, :].add_(residual, alpha=strength)
            else:
                out[:, self.video_start:self.video_stop, :].add_(residual, alpha=strength)
        return out

    def block_patch(self, attention, previous, block_index=0):
        def patch(args, extra):
            self.prepare(args["layout"], args["img"].device)
            options = dict(args["transformer_options"])
            prior_attention = options.get("optimized_attention_override")

            def override(original, q, k, v, heads, **kwargs):
                preferred = attention.function
                residual_backend = original if preferred is None else preferred
                if prior_attention is not None:
                    def backend(*values, **settings):
                        return prior_attention(original, *values, **settings)
                else:
                    backend = residual_backend
                return self.attention(backend, q, k, v, heads, block_index=block_index,
                                      residual_backend=residual_backend, **kwargs)

            def containers(q, k, v, heads, **kwargs):
                return override(optimized_attention, q.take(), k.take(), v.take(), heads, **kwargs)

            override.container_function = containers
            options["optimized_attention_override"] = override
            updated = {**args, "transformer_options": options}
            return extra["original_block"](updated) if previous is None else previous(updated, extra)
        return patch


class GuideAttention:
    def forward(self, executor, x, timestep, context, transformer_options, minimax_payload=None, **kwargs):
        guides = (minimax_payload or {}).get("keyframes", ())
        refs = (minimax_payload or {}).get("refs", ())
        guide_bias = any(guide.get(STRENGTH_KEY, 1.0) != 1.0 or MASK_KEY in guide or SOURCE_MASK_KEY in guide for guide in guides)
        refmod_bias = any(ref.get(REFMOD_ATTENTION_KEY, 1.0) != 1.0 for ref in refs)
        residuals = [ref[REFMOD_RESIDUAL_KEY] for ref in refs
                     if REFMOD_RESIDUAL_KEY in ref and ref.get("kind") in ("image", "video", "video_audio")]
        model = executor.class_obj
        residual_active = any(strength > 0 for strength, _, _ in residuals)
        if residual_active and not isinstance(model, MiniMaxH3Model):
            raise ValueError("VK Viggle: residual attention requires the native H3/Viggle model.")
        residual_blocks = [index for index in range(len(model.blocks)) if any(
            strength > 0 and index >= first and (last == 0 or index < last) for strength, first, last in residuals)] if residual_active else []
        sigma = float(timestep.flatten()[0]) / 1000.0
        refmods = [ref[REFMOD_ATTENTION_KEY] for ref in refs if REFMOD_ATTENTION_KEY in ref]
        guide_settings = [
            f"frame={guide['resolved_frame_index']} force={guide.get(STRENGTH_KEY, 1.0):g} "
            f"mask={guide.get(MASK_BOUNDARIES_KEY, 'soft') if MASK_KEY in guide else 'none'}"
            for guide in guides]
        native_refs = sum(REFMOD_ATTENTION_KEY not in ref and REFMOD_RESIDUAL_KEY not in ref for ref in refs)
        logging.info("[VK Attention] sigma=%.9g path=%s refmods=%s native_refs=%d guides=[%s] residual=%s blocks=%d",
                     sigma, "residual" if residual_blocks else "biased" if guide_bias or refmod_bias else "native", refmods,
                     native_refs, "; ".join(guide_settings), residuals, len(residual_blocks))
        if not guide_bias and not refmod_bias and not residual_blocks:
            return executor(x, timestep, context, transformer_options, minimax_payload=minimax_payload, **kwargs)
        if not isinstance(model, MiniMaxH3Model):
            raise ValueError("VK Viggle: guide attention requires the native H3/Viggle model.")
        state = GuideAttentionForward(guides, refs)
        options = dict(transformer_options)
        replacements = dict(options.get("patches_replace", {}))
        blocks = dict(replacements.get("dit", {}))
        for index, block in enumerate(model.blocks):
            if not guide_bias and not refmod_bias and index not in residual_blocks:
                continue
            key = ("double_block", index)
            blocks[key] = state.block_patch(block.attn.comfy_attention, blocks.get(key), index)
        replacements["dit"] = blocks
        options["patches_replace"] = replacements
        return executor(x, timestep, context, options, minimax_payload=minimax_payload, **kwargs)


class VKVigglePatchGuideAttention(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKVigglePatchGuideAttention",
            display_name="VK Vigglorious Patch Guide Attention",
            category="VK/Viggle",
            description="Apply scheduled native or residual attention for masked guides and RefMods. Connect MODEL after LoRAs to BasicGuider. Guides use native attention factors; RefMod residual uses added visual references. Guide masks select guide tokens; source masks restrict target-video queries. Both support hard/soft boundaries and outside attention.",
            inputs=[io.Model.Input("model", tooltip="Native H3/Viggle MODEL after LoRAs. Reads per-step guide and RefMod attention settings from conditioning. Use only one patch node.")],
            outputs=[io.Model.Output(tooltip="MODEL with guide and RefMod attention enabled. Without this patch, custom guide masks, factors and RefMod residual attention are ignored.")],
        )

    @classmethod
    def execute(cls, model):
        if not isinstance(model.get_model_object("diffusion_model"), MiniMaxH3Model):
            raise ValueError("VK Viggle: guide attention requires the native H3/Viggle model.")
        if model.get_wrappers(WrappersMP.DIFFUSION_MODEL, PATCH_KEY):
            raise ValueError("VK Viggle: use only one Patch Guide Attention node per MODEL path.")
        patched = model.clone()
        patched.add_wrapper_with_key(WrappersMP.DIFFUSION_MODEL, PATCH_KEY, GuideAttention().forward)
        return io.NodeOutput(patched)
