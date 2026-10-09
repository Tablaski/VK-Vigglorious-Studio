import { app } from "../../scripts/app.js";

function installSliders(node, guides = false) {
    const subject = guides ? "Guides" : "RefMods";
    const steps = node.widgets.find(widget => widget.name === "steps");
    const strengths = node.widgets.find(widget => widget.name === "strengths");
    const enabledSteps = node.widgets.find(widget => widget.name === "enabled_steps");
    const mode = guides ? null : node.widgets.find(widget => widget.name === "mode");
    const root = document.createElement("div");
    root.style.cssText = "display:flex;flex-direction:column;gap:6px;padding:8px;color:var(--input-text);background:var(--comfy-input-bg);box-sizing:border-box;width:100%;";
    strengths.hidden = true;
    strengths.type = "converted-widget";
    strengths.computeSize = () => [0, -4];
    if (strengths.inputEl) strengths.inputEl.style.display = "none";
    enabledSteps.hidden = true;
    enabledSteps.type = "converted-widget";
    enabledSteps.computeSize = () => [0, -4];
    if (enabledSteps.inputEl) enabledSteps.inputEl.style.display = "none";
    const widget = node.addDOMWidget("step_strengths", "VK_REFMOD_STEPS", root, {serialize:false});
    widget.serialize = false;
    widget.serializeValue = () => undefined;
    widget.options.getMinHeight = () => root.hidden ? 0 : root.childElementCount * 32 + 16;
    widget.options.getMaxHeight = widget.options.getMinHeight;
    const constant = guides ? node.widgets.find(widget => widget.name === "strength") : null;
    const visibility = guides ? [constant, steps].map(item => ({item, type:item.type, computeSize:item.computeSize})) : [];
    function rebuild() {
        if (guides) {
            const scheduled = node.inputs?.find(input => input.name === "sigmas")?.link != null;
            root.hidden = !scheduled;
            root.style.display = scheduled ? "flex" : "none";
            for (const original of visibility) {
                const hidden = original.item === constant ? scheduled : !scheduled;
                original.item.hidden = hidden;
                original.item.type = hidden ? "converted-widget" : original.type;
                original.item.computeSize = hidden ? () => [0, -4] : original.computeSize;
            }
        }
        let values, enabled;
        try { values = JSON.parse(strengths.value); } catch { values = []; }
        try { enabled = JSON.parse(enabledSteps.value); } catch { enabled = []; }
        if (!Array.isArray(values)) values = [];
        if (!Array.isArray(enabled)) enabled = [];
        const residual = !guides && mode.value === "residual_attention";
        const count = Math.max(1, Math.min(10000, Math.round(Number(steps.value) || 1)));
        values = Array.from({length:count}, (_, index) => Number.isFinite(values[index]) ? values[index] : guides ? (index === 0 ? 0.5 : 2) : residual ? 0 : 1);
        strengths.value = JSON.stringify(values);
        enabled = Array.from({length:count}, (_, index) => enabled[index] !== false);
        enabledSteps.value = JSON.stringify(enabled);
        const attention = guides || mode.value === "attention";
        root.replaceChildren();
        if (guides) {
            const title = document.createElement("strong");
            title.textContent = "Guides attention factor";
            root.append(title);
        }
        values.forEach((value, index) => {
            const row = document.createElement("label");
            row.style.cssText = "display:flex;align-items:center;gap:8px;min-height:26px;font-size:12px;";
            const name = document.createElement("span");
            name.textContent = `Step ${index + 1}`;
            name.style.minWidth = "48px";
            const toggle = document.createElement("input");
            toggle.type = "checkbox";
            toggle.checked = enabled[index];
            toggle.setAttribute("aria-label", `Enable ${subject} for step ${index + 1}`);
            toggle.title = guides
                ? "OFF removes this node's guides for this sigma interval. ON at factor 0 blocks direct guide access; indirect influence remains."
                : residual
                ? "OFF removes added RefMods, changing positions. Keep ON at coefficient 0 to retain native references without the extra branch."
                : attention
                ? "OFF removes added RefMods, changing sequence positions. ON retains references even at attention 0."
                : "OFF removes added RefMods. ON uses the installed Apply strength for this step.";
            const slider = document.createElement("input");
            slider.type = "range"; slider.min = "0"; slider.max = attention ? (guides ? "3" : "2") : "1"; slider.step = "0.01";
            slider.value = value;
            slider.style.cssText = "flex:1;min-width:0;";
            const number = document.createElement("input");
            number.type = "number"; number.min = "0"; number.step = "0.01";
            if (!attention && !residual) number.max = "1";
            number.value = value;
            number.style.cssText = "width:58px;color:inherit;background:var(--comfy-input-bg);border:1px solid var(--border-color);";
            number.setAttribute("aria-label", `Numeric ${guides ? "Guide" : "RefMod"} strength for step ${index + 1}`);
            row.title = guides
                ? "Attention factor: 1 is native, below 1 weakens direct guide attention, above 1 strengthens it. 0 blocks direct access. Defaults: 0.5 for step 1, then 2. Masks select swapped-guide regions; optional source masks are experimental. Slider: 0 to 3; numeric values have no upper limit."
                : residual
                ? "Residual: adds visual RefMod-only attention to video queries. 0 keeps native attention with references present. Try 0 / 0 / 0.1 for three steps. Not face-specific. Requires Patch Guide Attention; use residual_block_start/end to select blocks. Switching mode preserves values."
                : attention
                ? "Attention: references stay intact. 1 is native, below 1 reduces direct attention, above 1 increases it. 0 blocks direct access; indirect influence remains. Active Picker weights become 1; copies remain. Requires Patch Guide Attention."
                : "Latent: strength passed to installed Apply, multiplied by Picker weights. In the current Picker, positive values below 1 blur references; 0 removes them.";
            if (guides) slider.title = number.title = row.title;
            slider.setAttribute("aria-label", `${guides ? "Guide" : "RefMod"} ${residual ? "residual coefficient" : attention ? "attention" : "latent strength"} for step ${index + 1}`);
            slider.disabled = number.disabled = !enabled[index];
            toggle.addEventListener("change", () => {
                enabled[index] = toggle.checked;
                enabledSteps.value = JSON.stringify(enabled);
                slider.disabled = number.disabled = !toggle.checked;
                app.graph.setDirtyCanvas(true, true);
            });
            function update(input, other) {
                if (input.value === "" || !Number.isFinite(Number(input.value)) || Number(input.value) < 0) return;
                values[index] = Number(input.value);
                other.value = input.value;
                strengths.value = JSON.stringify(values);
                app.graph.setDirtyCanvas(true, true);
            }
            slider.addEventListener("input", () => update(slider, number));
            number.addEventListener("input", () => update(number, slider));
            row.append(toggle, name, slider, number); root.append(row);
        });
        node.setSize([Math.max(340, node.size[0]), node.computeSize()[1]]);
        app.graph.setDirtyCanvas(true, true);
    }
    const callback = steps.callback;
    steps.callback = function (...args) { const result = callback?.apply(this, args); rebuild(); return result; };
    if (mode) {
        const modeCallback = mode.callback;
        mode.callback = function (...args) { const result = modeCallback?.apply(this, args); rebuild(); return result; };
    }
    if (guides) {
        const connections = node.onConnectionsChange;
        node.onConnectionsChange = function (...args) { const result = connections?.apply(this, args); rebuild(); return result; };
    }
    const configured = node.onConfigure;
    node.onConfigure = function (...args) { const result = configured?.apply(this, args); rebuild(); return result; };
    rebuild();
}

app.registerExtension({
    name: "VK.WrapperScheduleRefModApply",
    beforeConfigureGraph(graphData) {
        for (const graph of [graphData, ...(graphData.definitions?.subgraphs || [])]) {
            for (const node of graph.nodes || []) {
                if (node.type !== "VKAttentionMaskedGuide") continue;
                const values = node.widgets_values;
                if (!Array.isArray(values)) continue;
                if (typeof values[0] === "boolean") values.splice(0, 1);
                if (["attention", "residual_attention"].includes(values[2])) {
                    values.splice(2, 1);
                    if (typeof values[5] === "boolean") {
                        const guideMask = values[5], sourceMask = values[6], reuse = values[8];
                        for (const input of node.inputs || []) {
                            if (!(input.name === "masks" && (!guideMask || reuse) || input.name === "source_masks" && !sourceMask)) continue;
                            const id = input.link;
                            input.link = null;
                            graph.links = (graph.links || []).filter(link => (Array.isArray(link) ? link[0] : link.id) !== id);
                            for (const source of graph.nodes || []) {
                                for (const output of source.outputs || []) {
                                    if (output.links) output.links = output.links.filter(link => link !== id);
                                }
                            }
                        }
                        values.splice(8, 1);
                        values.splice(5, 2);
                    }
                }
            }
        }
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (!["VKWrapperScheduleRefModApply", "VKAttentionMaskedGuide"].includes(nodeData.name)) return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) {
            const result = created?.apply(this, args);
            installSliders(this, nodeData.name === "VKAttentionMaskedGuide");
            return result;
        };
    },
});
