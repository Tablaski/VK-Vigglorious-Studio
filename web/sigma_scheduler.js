import { app } from "../../scripts/app.js";

const NS = "http://www.w3.org/2000/svg";
const format = value => Number(value.toPrecision(12)).toString();
const serialize = values => values.map(format).join(", ");

function parse(text) {
    const values = String(text).trim().replace(/^\[/, "").replace(/\]$/, "").trim().split(/[\s,;]+/).filter(Boolean).map(Number);
    return values.length >= 2 && values.every(value => Number.isFinite(value) && value >= 0) ? values : null;
}

function resample(values, count) {
    const last = values.length - 1;
    return Array.from({length:count + 1}, (_, index) => {
        if (index === 0) return values[0];
        if (index === count) return values[last];
        const position = index * last / count, left = Math.min(Math.floor(position), last - 1);
        return Number((values[left] + (values[left + 1] - values[left]) * (position - left)).toPrecision(12));
    });
}

function installEditor(node) {
    const steps = node.widgets.find(widget => widget.name === "steps");
    const sigmas = node.widgets.find(widget => widget.name === "sigmas");
    for (const widget of [steps, sigmas]) {
        widget.hidden = true;
        widget.type = "converted-widget";
        widget.computeSize = () => [0, -4];
        if (widget.inputEl) widget.inputEl.style.display = "none";
    }
    const root = document.createElement("div");
    root.style.cssText = "width:100%;box-sizing:border-box;color:var(--input-text);background:var(--comfy-input-bg);font:12px sans-serif;";
    root.setAttribute("aria-label", "VK Viggle Sigma Scheduler editor");
    const content = document.createElement("div");
    content.style.cssText = "padding:10px;box-sizing:border-box;";
    root.append(content);
    const row = () => {
        const element = document.createElement("div");
        element.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px;";
        return element;
    };
    const field = (tag, label) => {
        const element = document.createElement(tag);
        element.setAttribute("aria-label", label);
        element.style.cssText = "box-sizing:border-box;color:inherit;background:var(--comfy-input-bg);border:1px solid var(--border-color);border-radius:4px;padding:5px;font:inherit;";
        return element;
    };
    const toolbar = row();
    const label = document.createElement("span"); label.textContent = "Steps";
    const minus = field("button", "Remove one step"); minus.textContent = "−"; minus.type = "button";
    const count = field("input", "Number of sampling steps"); count.type = "number"; count.min = "1"; count.max = "10000"; count.step = "1"; count.style.width = "68px";
    count.title = "N steps produce N+1 sigma values. Changing this count linearly resamples the current curve, preserving its endpoints.";
    const plus = field("button", "Add one step"); plus.textContent = "+"; plus.type = "button";
    const toggle = field("button", "Collapse graph"); toggle.type = "button"; toggle.textContent = "Collapse graph"; toggle.style.marginLeft = "auto";
    toggle.setAttribute("aria-expanded", "true");
    toggle.title = "Expand or collapse both curves. Steps and sigma values remain editable.";
    toolbar.append(label, minus, count, plus, toggle);
    const graph = document.createElement("div");
    const legend = row(); legend.style.fontSize = "12px";
    const sigmaInk = "#77bfff", flowInk = "#edb568";
    for (const [name, ink, dashed] of [["Sigma σ", sigmaInk, false], ["Video flow (%)", flowInk, true]]) {
        const item = document.createElement("span"); item.style.cssText = "display:inline-flex;align-items:center;gap:6px;";
        const swatch = document.createElement("span"); swatch.style.cssText = `width:18px;border-top:2px ${dashed ? "dashed" : "solid"} ${ink};`;
        item.append(swatch, name); legend.append(item);
    }
    const chart = document.createElementNS(NS, "svg");
    chart.style.cssText = "display:block;width:100%;height:205px;touch-action:none;cursor:crosshair;";
    chart.setAttribute("role", "img"); chart.setAttribute("aria-label", "Editable sigma and Video flow curves by sampling step");
    graph.append(legend, chart);
    const selectedRow = row();
    const pointLabel = document.createElement("span");
    const number = field("input", "Selected point sigma"); number.type = "number"; number.min = "0"; number.step = "0.001"; number.style.width = "100px";
    number.title = "Click or drag a point on either curve to select it. Editing sigma updates both curves and the sigma list.";
    const progress = document.createElement("span");
    selectedRow.append(pointLabel, number, progress);
    const textLabel = document.createElement("label"); textLabel.textContent = "sigmas";
    const text = field("textarea", "Sigma values, synchronized with the curve"); text.rows = 1; text.spellcheck = false; text.style.cssText += "display:block;width:100%;resize:vertical;font-family:monospace;";
    text.title = "Enter nonnegative sigma values separated by commas, spaces or semicolons. Valid text sets the step count. Values above one and nonzero endpoints are preserved.";
    textLabel.append(text);
    const status = document.createElement("div"); status.style.cssText = "margin-top:6px;"; status.setAttribute("aria-live", "polite");
    const note = document.createElement("div"); note.style.cssText = "margin-top:5px;opacity:0.8;";
    note.textContent = "H3 video flow: 100 × (1 − σ). Schedule coordinate, not measured noise removal or KSampler denoise.";
    const error = document.createElement("div"); error.setAttribute("role", "alert"); error.style.cssText = "margin-top:5px;color:var(--error-text, var(--input-text));";
    content.append(toolbar, graph, selectedRow, textLabel, status, note, error);
    const widget = node.addDOMWidget("sigma_curve", "VK_SIGMA_CURVE", root, {serialize:false});
    widget.serialize = false; widget.serializeValue = () => undefined;
    widget.options.getMinHeight = () => content.offsetHeight || (graph.hidden ? 150 : 380);
    widget.options.getMaxHeight = widget.options.getMinHeight;
    let values = parse(sigmas.value) || [1, 0.9, 0.45, 0], selected = 1, drag = null, plot;

    function dirty() { app.graph.setDirtyCanvas(true, true); }
    function fit(shrink = false) {
        const height = node.computeSize()[1];
        if (shrink || node.size[1] < height) node.setSize([node.size[0], height]);
        dirty();
    }
    function mark(message = "") { error.textContent = message; text.setAttribute("aria-invalid", message ? "true" : "false"); }
    function element(tag, attributes, content) {
        const item = document.createElementNS(NS, tag);
        for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, value);
        if (content !== undefined) item.textContent = content;
        chart.append(item); return item;
    }
    function draw() {
        const width = chart.clientWidth;
        if (!width) return;
        const last = values.length - 1;
        const maximum = drag?.maximum || Math.max(1, ...values);
        const left = 42, right = width - 48, top = 18, bottom = 164;
        plot = {width, left, right, top, bottom, maximum, last};
        chart.setAttribute("viewBox", `0 0 ${width} 205`); chart.replaceChildren();
        element("title", {}, `${last} steps, ${values.length} sigmas. ${serialize(values)}`);
        const x = index => left + (right - left) * index / last;
        const fg = "var(--input-text)", grid = "var(--border-color)";
        element("text", {x:left, y:12, fill:fg, "font-size":12}, "σ");
        element("text", {x:right, y:12, fill:fg, "text-anchor":"end", "font-size":12}, "%");
        for (let index = 0; index <= 4; index++) {
            const yy = bottom - (bottom - top) * index / 4;
            element("line", {x1:left, x2:right, y1:yy, y2:yy, stroke:grid, "stroke-width":1});
            element("text", {x:left - 8, y:yy + 4, fill:fg, "text-anchor":"end", "font-size":11}, Number((maximum * index / 4).toPrecision(3)).toString());
            element("text", {x:right + 6, y:yy + 4, fill:fg, "font-size":11}, `${Number((100 * (1 - maximum + maximum * index / 4)).toPrecision(3))}%`);
        }
        const ticks = last <= 6 ? Array.from({length:last + 1}, (_, index) => index) : [...new Set([0, Math.round(last / 3), Math.round(last * 2 / 3), last])];
        for (const index of ticks) {
            element("line", {x1:x(index), x2:x(index), y1:top, y2:bottom, stroke:grid, "stroke-width":1});
            element("text", {x:x(index), y:bottom + 20, fill:fg, "text-anchor":"middle", "font-size":12}, index);
        }
        element("text", {x:(left + right) / 2, y:202, fill:fg, "text-anchor":"middle", "font-size":12}, "Sampling step");
        const points = last <= 70 ? Array.from({length:last + 1}, (_, index) => index) : [...new Set([0, selected, last])];
        for (const [series, ink] of [["sigma", sigmaInk], ["flow", flowInk]]) {
            const y = value => series === "flow" ? top + (bottom - top) * value / maximum : bottom - (bottom - top) * value / maximum;
            element("path", {d:values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" "), fill:"none", stroke:ink, "stroke-width":2, "stroke-dasharray":series === "flow" ? "5 4" : "none", "data-series":series});
            for (const index of points) {
                const dot = element("circle", {cx:x(index), cy:y(values[index]), r:index === selected ? 5 : 4, fill:index === selected ? ink : "var(--comfy-input-bg)", stroke:ink, "stroke-width":2, "data-point":index, "data-series":series});
                const title = document.createElementNS(NS, "title"); title.textContent = `Point ${index}: σ ${format(values[index])} · Video flow ${format(100 * (1 - values[index]))}%`; dot.append(title);
            }
        }
    }
    function render(syncText = true) {
        const last = values.length - 1;
        selected = Math.min(selected, last); count.value = last; steps.value = last;
        minus.disabled = last <= 1; plus.disabled = last >= 10000;
        if (syncText) text.value = serialize(values);
        pointLabel.textContent = `Point ${selected} · σ`;
        number.value = format(values[selected]);
        progress.textContent = `${format(100 * (1 - values[selected]))}% video flow progress`;
        status.textContent = `${last} steps · ${last + 1} sigmas`;
        if (values.some((value, index) => index && value >= values[index - 1])) mark("Non-descending schedule: the RefMod wrapper requires strictly descending sigmas.");
        draw(); dirty();
    }
    function updateSteps(next) {
        if (!Number.isInteger(next) || next < 1 || next > 10000) { count.value = values.length - 1; steps.value = values.length - 1; return; }
        values = resample(values, next); sigmas.value = serialize(values); mark(); render();
    }
    minus.addEventListener("click", () => updateSteps(values.length - 2));
    plus.addEventListener("click", () => updateSteps(values.length));
    count.addEventListener("change", () => updateSteps(Number(count.value)));
    toggle.addEventListener("click", () => {
        graph.hidden = !graph.hidden;
        toggle.textContent = graph.hidden ? "Expand graph" : "Collapse graph";
        toggle.setAttribute("aria-label", toggle.textContent);
        toggle.setAttribute("aria-expanded", String(!graph.hidden));
        draw(); fit(true);
    });
    text.addEventListener("input", () => {
        sigmas.value = text.value;
        const parsed = parse(text.value);
        if (!parsed) { mark("Enter at least two finite, nonnegative sigmas. Previous curve retained; fix text before running."); return; }
        values = parsed; mark(); render(false);
    });
    number.addEventListener("change", () => {
        const parsed = number.value.trim() === "" ? NaN : Number(number.value);
        if (!Number.isFinite(parsed) || parsed < 0) { mark("Enter a finite, nonnegative sigma."); number.value = format(values[selected]); return; }
        values[selected] = parsed; sigmas.value = serialize(values); mark(); render();
    });
    chart.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !plot) return;
        const bounds = chart.getBoundingClientRect();
        const px = (event.clientX - bounds.left) * plot.width / bounds.width, py = (event.clientY - bounds.top) * 205 / bounds.height;
        const index = Math.round((px - plot.left) / (plot.right - plot.left) * plot.last);
        if (index < 0 || index > plot.last) return;
        const x = plot.left + (plot.right - plot.left) * index / plot.last;
        const sigmaY = plot.bottom - (plot.bottom - plot.top) * values[index] / plot.maximum;
        const flowY = plot.top + (plot.bottom - plot.top) * values[index] / plot.maximum;
        const flow = event.target.getAttribute("data-series") === "flow" || (event.target.getAttribute("data-series") !== "sigma" && Math.abs(py - flowY) < Math.abs(py - sigmaY));
        if (Math.hypot(px - x, py - (flow ? flowY : sigmaY)) > 24) return;
        selected = index; drag = {id:event.pointerId, maximum:plot.maximum, flow}; chart.setPointerCapture(event.pointerId); mark(); render(); event.preventDefault();
    });
    chart.addEventListener("pointermove", event => {
        if (drag?.id !== event.pointerId) return;
        const bounds = chart.getBoundingClientRect(), y = (event.clientY - bounds.top) * 205 / bounds.height;
        let value = (drag.flow ? y - plot.top : plot.bottom - y) / (plot.bottom - plot.top) * drag.maximum;
        const high = selected === 0 ? drag.maximum : values[selected - 1];
        const low = selected === plot.last ? 0 : values[selected + 1];
        if (high > low) {
            const gap = Math.min(0.000001, (high - low) / 100);
            value = Math.min(high - (selected === 0 ? 0 : gap), Math.max(low + (selected === plot.last ? 0 : gap), value));
        }
        values[selected] = Number(Math.max(0, value).toPrecision(12)); sigmas.value = serialize(values); mark(); render();
    });
    function finish(event) { if (drag?.id !== event.pointerId) return; drag = null; render(); }
    chart.addEventListener("pointerup", finish); chart.addEventListener("pointercancel", finish);
    const callback = steps.callback;
    steps.callback = function (...args) { const result = callback?.apply(this, args); updateSteps(Number(steps.value)); return result; };
    const textCallback = sigmas.callback;
    sigmas.callback = function (...args) {
        const result = textCallback?.apply(this, args), parsed = parse(sigmas.value);
        if (parsed) { values = parsed; mark(); render(); } else mark("Enter at least two finite, nonnegative sigmas.");
        return result;
    };
    const configured = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = configured?.apply(this, args), parsed = parse(sigmas.value);
        if (parsed) { values = resample(parsed, Number(steps.value)); sigmas.value = serialize(values); mark(); render(); }
        else { text.value = sigmas.value; mark("Enter at least two finite, nonnegative sigmas."); }
        fit(); return result;
    };
    const observer = new ResizeObserver(() => { draw(); fit(); });
    observer.observe(content);
    const removed = node.onRemoved;
    node.onRemoved = function (...args) { observer.disconnect(); return removed?.apply(this, args); };
    values = resample(values, Math.max(1, Math.round(Number(steps.value) || 3)));
    sigmas.value = serialize(values); render();
    node.setSize([Math.max(460, node.size[0]), node.computeSize()[1]]);
}

app.registerExtension({
    name:"VK.ViggleSigmaScheduler",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "VKViggleSigmaScheduler") return;
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function (...args) { const result = created?.apply(this, args); installEditor(this); return result; };
    },
});
