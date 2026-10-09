import math
import re

import torch
from comfy_api.latest import io


def parse_sigmas(text):
    values = [float(value) for value in re.split(r"[\s,;]+", text.strip().removeprefix("[").removesuffix("]").strip()) if value]
    if len(values) < 2 or any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("VK Sigma Scheduler: enter at least two finite, nonnegative sigmas.")
    return values


def interpolate_sigmas(values, steps):
    if steps < 1:
        raise ValueError("VK Sigma Scheduler: steps must be at least 1.")
    if len(values) == steps + 1:
        return values
    result = []
    last = len(values) - 1
    for index in range(steps + 1):
        position = index * last / steps
        left = min(int(position), last - 1)
        result.append(values[left] + (values[left + 1] - values[left]) * (position - left))
    result[0], result[-1] = values[0], values[-1]
    return result


class VKViggleSigmaScheduler(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="VKViggleSigmaScheduler",
            display_name="VK Vigglorious Sigma Scheduler",
            category="VK/Viggle",
            description="Edit sigma and H3 Video flow curves together, or collapse the graph and edit the sigma text. Changing steps linearly resamples the current curve while preserving both endpoints. Video flow shows 100 × (1 − sigma), a schedule coordinate, not measured denoising or KSampler denoise. Sigma values are unchanged for other models.",
            inputs=[
                io.Int.Input("steps", default=3, min=1, max=10000, tooltip="Number of sampling transitions; N steps produce N+1 sigma values. Plus/minus resamples the current curve linearly. Pasting text in the editor sets steps from its point count. API prompts resample the supplied list to this count."),
                io.String.Input("sigmas", default="1.0, 0.9, 0.45, 0.0", multiline=True, tooltip="Comma-, whitespace- or semicolon-separated sigma values, optionally in brackets. Dragging points updates this text; editing valid text updates the curve. Values are not normalized; a nonzero final sigma is preserved. Start with 1, 0.9, 0.45, 0 for three Viggle steps."),
            ],
            outputs=[io.Sigmas.Output(display_name="SIGMAS", tooltip="Native one-dimensional float32 SIGMAS tensor, including both endpoints. Connect to SamplerCustomAdvanced sigmas and the RefMod wrapper sigmas. Set wrapper steps to the same count. No model or execution is needed to edit the curve.")],
        )

    @classmethod
    def execute(cls, steps, sigmas):
        return io.NodeOutput(torch.tensor(interpolate_sigmas(parse_sigmas(sigmas), steps), dtype=torch.float32))
