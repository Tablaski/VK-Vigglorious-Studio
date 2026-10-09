import json
import math

import nodes
import torch
from comfy_api.latest import io
from comfy_execution.graph_utils import GraphBuilder


APPLY_NODE = "H3RefModApplySimple"
REFMOD_ATTENTION_KEY = "vk_refmod_attention"
REFMOD_RESIDUAL_KEY = "vk_refmod_residual_attention"


def sigma_intervals(sigmas, steps):
    schedule = sigmas.tolist()
    if len(schedule) != steps + 1:
        raise ValueError(f"VK Sigma Schedule: steps={steps}, but the sigma schedule has {len(schedule) - 1} steps.")
    if any(not math.isfinite(value) or value < 0 for value in schedule) or any(
        start <= end for start, end in zip(schedule, schedule[1:])
    ):
        raise ValueError("VK Sigma Schedule: sigmas must be finite, nonnegative and strictly descending.")
    precision = torch.finfo(sigmas.dtype)
    mantissa = round(-math.log2(precision.eps))
    intervals = []
    for index, (start, end) in enumerate(zip(schedule, schedule[1:])):
        # Native sigma ranges include both endpoints; assign each boundary to its next step.
        if index + 1 < steps:
            exponent = math.frexp(end)[1]
            end += max(math.ldexp(1.0, exponent - 1 - mantissa), precision.tiny * precision.eps)
        intervals.append((start, end))
    return intervals


def restrict_conditioning(conditioning, sigma_start, sigma_end, previous=None):
    result = list(previous or [])
    for embedding, metadata in conditioning:
        if any(key in metadata for key in ("start_percent", "end_percent", "clip_start_percent", "clip_end_percent")):
            raise ValueError("VK Sigma Schedule: connect unscheduled conditioning; percentage ranges would override its sigma intervals.")
        item = dict(metadata)
        item["timestep_start"] = min(sigma_start, item.get("timestep_start", sigma_start))
        item["timestep_end"] = max(sigma_end, item.get("timestep_end", sigma_end))
        if item["timestep_start"] >= item["timestep_end"]:
            result.append([embedding, item])
    return result


class VKWrapperScheduleRefModApply(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKWrapperScheduleRefModApply",
            display_name="VK Vigglorious Wrapper Schedule RefMod Apply",
            category="VK/Viggle",
            description="Schedule RefMods per sigma step. Latent uses installed Apply strengths; attention changes native attention; residual_attention adds a separate visual RefMod attention branch. Both attention modes require Patch Guide Attention on MODEL. For late refinement, keep every step ON and try residual strengths 0 / 0 / 0.1.",
            enable_expand=True,
            inputs=[
                io.Conditioning.Input("conditioning", raw_link=True, tooltip="Conditioning before RefMod Apply, optionally from Attention-Masked Guide. Its text, guides and existing references are preserved. Do not feed percentage-scheduled conditioning."),
                io.Sigmas.Input("sigmas", tooltip="Complete descending sigma schedule. N+1 sigma values define N steps. Connect the same source to the single sampler."),
                io.Custom("H3_REF_MODS").Input("mods", raw_link=True, optional=True, tooltip="RefMod Picker bundle. Latent multiplies Picker weights by step strength. Both attention modes keep positive-weight entries at full latent strength; zero-weight entries stay excluded and copies remain. Unconnected bypasses conditioning."),
                io.Int.Input("steps", default=3, min=1, max=10000, tooltip="Number of sampling transitions. Creates one strength slider per step before execution. Must equal the number of sigmas minus one; start with 3 for the current Viggle schedule."),
                io.String.Input("strengths", default="[0.5,1.0,1.0]", tooltip="JSON list saved by the sliders, one value per transition. Latent: installed Apply strength. Attention: 1 is native, 0 blocks direct RefMod access. Residual: added branch coefficient; 0 keeps native attention, 0.1 is a small experimental addition. Not identity or denoise percentages."),
                io.Boolean.Input("use_video", default=True, tooltip="Pass visual-reference enablement to Apply H3 RefMod Simple. Off excludes its visual references."),
                io.Boolean.Input("use_audio", default=False, tooltip="Include embedded audio when available. Start disabled for visual identity tests. Residual attention uses visual RefMod tokens only; included audio remains in native attention."),
                io.Combo.Input("mode", options=["latent", "attention", "residual_attention"], default="latent", tooltip="Latent uses installed Apply strengths. Attention biases native video-to-RefMod attention (1 is native). Residual adds visual RefMod-only attention before H3 output projection and gating (0 is native with refs). Requires Patch Guide Attention. Switching mode preserves slider values; set them explicitly, starting with 0 / 0 / 0.1 for residual."),
                io.String.Input("enabled_steps", default="[]", tooltip="JSON booleans saved by the per-step ON switches. Empty means all ON. OFF removes added RefMods, changing reference positions. Keep ON with residual strength 0 to disable only the added branch while retaining native references."),
                io.Int.Input("residual_block_start", default=0, min=0, max=10000, tooltip="First DiT block receiving the residual branch, zero-based and inclusive. Used only in residual_attention mode. Start at 0; increase to restrict injection to later blocks."),
                io.Int.Input("residual_block_end", default=0, min=0, max=10000, tooltip="Exclusive last DiT block for the residual branch. 0 means through the final block. H3 has 50 blocks: 0 / 50 selects all, 25 / 50 selects the last half. Other attention modes ignore this setting."),
            ],
            outputs=[
                io.Conditioning.Output(display_name="conditioning", tooltip="Scheduled conditioning for the single BasicGuider. Each strength uses its full-schedule sigma interval."),
                io.Sigmas.Output(display_name="SIGMAS", tooltip="The complete input sigma schedule, passed through unchanged. Connect directly to SamplerCustomAdvanced sigmas so scheduling and sampling use the same values."),
            ],
        )

    @classmethod
    def execute(cls, conditioning, sigmas, steps=3,
                strengths="[0.5,1.0,1.0]", mods=None, use_video=True, use_audio=False,
                mode="latent", enabled_steps="[]", residual_block_start=0, residual_block_end=0):
        if mods is None or not (use_video or use_audio):
            return io.NodeOutput(conditioning, sigmas, expand={})
        if APPLY_NODE not in nodes.NODE_CLASS_MAPPINGS:
            raise ValueError("VK RefMod Scheduler: install/enable Apply H3 RefMod Simple and restart ComfyUI.")
        values = json.loads(strengths)
        if not isinstance(values, list) or len(values) != steps or any(
            isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
            for value in values
        ):
            raise ValueError("VK RefMod Scheduler: provide one finite strength per step.")
        enabled = json.loads(enabled_steps)
        if enabled == []:
            enabled = [True] * steps
        if not isinstance(enabled, list) or len(enabled) != steps or any(type(value) is not bool for value in enabled):
            raise ValueError("VK RefMod Scheduler: provide one ON/OFF boolean per step.")
        if mode not in ("latent", "attention", "residual_attention"):
            raise ValueError("VK RefMod Scheduler: unknown mode.")
        if mode != "latent" and any(value < 0 for value in values):
            raise ValueError("VK RefMod Scheduler: attention strengths must be nonnegative.")
        if mode == "residual_attention" and (residual_block_start < 0 or residual_block_end < 0 or
                residual_block_end != 0 and residual_block_end <= residual_block_start):
            raise ValueError("VK RefMod Scheduler: residual block end must be 0 or greater than block start.")
        intervals = sigma_intervals(sigmas, steps)
        graph = GraphBuilder()
        previous = None
        first = 0
        for index, strength in enumerate(values):
            if index + 1 < steps and (enabled[index], strength) == (enabled[index + 1], values[index + 1]):
                continue
            current = conditioning
            if enabled[index]:
                settings = {} if mode != "residual_attention" else {
                    "mode": mode, "residual_block_start": residual_block_start, "residual_block_end": residual_block_end}
                applied = graph.node(APPLY_NODE if mode == "latent" else "VKViggleRefModAttentionApply",
                                     conditioning=conditioning, mods=mods, strength=strength,
                                     use_video=use_video, use_audio=use_audio, **settings)
                current = applied.out(0)
            scheduled = graph.node("VKViggleRefModStepConditioning", conditioning=current,
                                   sigma_start=intervals[first][0], sigma_end=intervals[index][1], previous=previous)
            previous = scheduled.out(0)
            first = index + 1
        return io.NodeOutput(previous, sigmas, expand=graph.finalize())


class VKViggleRefModAttentionApply(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleRefModAttentionApply", display_name="VK Vigglorious RefMod Attention Apply (internal)",
            category="VK/Viggle/internal", is_dev_only=True,
            description="Apply active Picker references intact, then mark only newly appended references for the VK attention patch.",
            inputs=[
                io.Conditioning.Input("conditioning", tooltip="Conditioning before the RefMod wrapper; existing references are preserved."),
                io.Custom("H3_REF_MODS").Input("mods", tooltip="Active Picker entries. Positive weights become 1; existing copies remain copies."),
                io.Float.Input("strength", min=0, tooltip="Attention mode: direct RefMod multiplier, 1 is native. Residual mode: additional visual branch coefficient, 0 is native with refs."),
                io.Boolean.Input("use_video", tooltip="Include visual RefMod references."),
                io.Boolean.Input("use_audio", tooltip="Include audio RefMod references. Attention mode also biases their access from video queries; residual mode leaves their native attention unchanged."),
                io.Combo.Input("mode", options=["attention", "residual_attention"], default="attention", tooltip="Select the metadata consumed by Patch Guide Attention. Residual mode changes only visual reference access in its additional branch."),
                io.Int.Input("residual_block_start", default=0, min=0, tooltip="Inclusive first residual block, zero-based."),
                io.Int.Input("residual_block_end", default=0, min=0, tooltip="Exclusive residual block end; 0 selects through the final block."),
            ], outputs=[io.Conditioning.Output(tooltip="Conditioning with intact added references and their bias or visual residual settings.")],
        )

    @classmethod
    def execute(cls, conditioning, mods, strength, use_video, use_audio, mode="attention",
                residual_block_start=0, residual_block_end=0):
        active = [(mod, 1.0) for mod, weight in mods if weight > 0]
        applied = nodes.NODE_CLASS_MAPPINGS[APPLY_NODE].execute(
            conditioning=conditioning, mods=active, strength=1.0,
            use_video=use_video, use_audio=use_audio).result[0]
        result = []
        setting = {REFMOD_RESIDUAL_KEY: (strength, residual_block_start, residual_block_end)} if mode == "residual_attention" else {REFMOD_ATTENTION_KEY: strength}
        for (embedding, metadata), (_, source) in zip(applied, conditioning):
            original_count = len(source.get("minimax_refs", []))
            refs = metadata.get("minimax_refs", [])
            item = dict(metadata)
            item["minimax_refs"] = list(refs[:original_count]) + [
                dict(ref, **setting) for ref in refs[original_count:]]
            result.append([embedding, item])
        return io.NodeOutput(result)


class VKViggleRefModStepConditioning(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleRefModStepConditioning",
            display_name="VK Vigglorious RefMod Step Conditioning (internal)",
            category="VK/Viggle/internal",
            is_dev_only=True,
            description="Internal Scheduler helper. Restricts an Apply result to its sigma interval and accumulates scheduled conditioning without scaling text or guide strengths.",
            inputs=[
                io.Conditioning.Input("conditioning", tooltip="Result of the installed Apply H3 RefMod Simple for this strength."),
                io.Float.Input("sigma_start", tooltip="Inclusive upper sigma boundary supplied by the Scheduler."),
                io.Float.Input("sigma_end", tooltip="Inclusive lower boundary, adjusted to exclude the next step's starting sigma."),
                io.Conditioning.Input("previous", optional=True, tooltip="Earlier scheduled intervals. Absent starts a new conditioning list."),
            ],
            outputs=[io.Conditioning.Output(tooltip="Accumulated conditioning with disjoint sigma intervals.")],
        )

    @classmethod
    def execute(cls, conditioning, sigma_start, sigma_end, previous=None):
        return io.NodeOutput(restrict_conditioning(conditioning, sigma_start, sigma_end, previous))
