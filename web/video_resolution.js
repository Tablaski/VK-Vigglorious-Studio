import { api } from "../../../scripts/api.js";

export function buildResolutionUI(node, root, context) {
    const widget = node.widgets.find((item) => item.name === "resolution_config");
    widget.hidden = true;
    const style = document.createElement("style");
    style.textContent = `
        .vk-resolution { background:#191b20; color:#ddd; border:1px solid #555; border-radius:10px;
            width:min(980px,90vw); max-height:90vh; overflow:auto; padding:18px; font:14px sans-serif; }
        .vk-resolution::backdrop { background:#000b; }
        .vk-resolution header,.vk-resolution footer { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .vk-resolution h2 { margin:0; }
        .vk-resolution .body { display:grid; grid-template-columns:1fr 1.2fr; gap:24px; margin:20px 0; }
        .vk-resolution fieldset { border:0; padding:0; margin:0 0 18px; }
        .vk-resolution legend { margin-bottom:8px; font-weight:bold; }
        .vk-resolution .options { display:flex; flex-wrap:wrap; gap:6px; }
        .vk-resolution button { background:#30343e; color:#eee; border:1px solid #555; border-radius:5px; padding:8px; cursor:pointer; }
        .vk-resolution button[aria-pressed=true],.vk-resolution .apply { background:#355d43; border-color:#48e084; }
        .vk-resolution button:disabled,.vk-resolution input:disabled { opacity:.45; cursor:default; }
        .vk-resolution input { width:85px; color:#eee; background:#30343e; border:1px solid #555; padding:8px; }
        .vk-resolution .dimensions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; }
        .vk-resolution .custom-budget { margin:12px 0; }
        .vk-resolution .scale-control { display:flex; align-items:center; gap:8px; margin:12px 0; }
        .vk-resolution .scale-control input { flex:1; width:auto; min-width:60px; padding:0; }
        .vk-resolution .scale-control output { min-width:48px; text-align:right; }
        .vk-resolution .stage { position:relative; width:100%; background:#08090b; overflow:hidden; }
        .vk-resolution .source { display:block; width:100%; height:100%; object-fit:contain; }
        .vk-resolution .crop { position:absolute; border:2px solid #48e084; box-sizing:border-box;
            box-shadow:0 0 0 1000px #0007; cursor:move; touch-action:none; }
        .vk-resolution .result { display:block; width:100%; height:220px; object-fit:contain; background:#08090b; }
        .vk-resolution .summary { margin:12px 0; line-height:1.6; }
        .vk-resolution .error { color:#ff8b8b; min-height:18px; }
        @media(max-width:650px) { .vk-resolution .body { grid-template-columns:1fr; } }
    `;
    if (!document.getElementById("vk-resolution-style")) { style.id = "vk-resolution-style"; document.head.append(style); }
    const dialog = document.createElement("dialog");
    dialog.className = "vk-resolution";
    dialog.setAttribute("aria-label", "Resolution");
    const groups = {
        profile: [["original", "Original"], ["viggle", "Viggle"], ["h3", "H3 Base"], ["custom", "Custom"]],
        budget: [["test", "Test · 0.4 MP"], ["standard", "Standard · 0.6 MP"], ["detail", "Detail · 1.2 MP"], ["custom", "Custom MP"]],
        format: ["source", "16:9", "9:16", "1:1", "4:3", "3:4"].map((value) => [value, value === "source" ? "Source" : value]),
        fit: [["crop", "Crop"], ["pad", "Pad"]],
    };
    dialog.innerHTML = `<header><h2>Resolution</h2><button class="close" aria-label="Close resolution settings">×</button></header>
        <div class="body"><div>${Object.entries(groups).map(([group, options]) =>
            `<fieldset data-group="${group}"><legend>${{profile:"Profile",budget:"Resolution",format:"Format",fit:"Fit"}[group]}</legend><div class="options">${options.map(([value, label]) =>
                `<button data-value="${value}" title="${group === "fit" ? value === "crop" ? "Fill the output by cropping; drag the green frame to reposition." : "Keep the full source image and add black bands." : group === "profile" ? value === "original" ? "Keep original dimensions without resizing or cropping." : value === "h3" ? "Set the short side to 768 pixels, aligned to the pixel multiple." : value === "custom" ? "Choose megapixels or output dimensions and scale them, aligned to the pixel multiple." : "Choose a target pixel budget for Viggle." : group === "format" ? "Choose the output aspect ratio. Source follows the video." : "Approximate output pixel budget; actual dimensions are aligned to the pixel multiple."}">${label}</button>`).join("")}</div></fieldset>`).join("")}
        <div class="custom-budget"><label>Custom MP <input class="budget-mp" type="number" min="0.001" step="0.01" value="0.6" title="Target megapixels for Custom MP. Dimensions follow the selected format and pixel multiple; start with 0.6."></label></div>
        <div class="custom-budget"><label>Pixel multiple <input class="multiple" type="number" min="1" max="16384" step="1" value="32" title="Round both resized dimensions to this pixel multiple. Start with 32; Original keeps source dimensions."></label></div>
        <div class="custom-budget"><label><input class="default-videos" type="checkbox" style="width:auto" title="Remember the current megapixel budget, format, fit and pixel multiple in this browser for future video loads. Uncheck and Apply to disable."> Default setting for all videos</label></div>
        <div class="custom-budget"><label>Custom resolution <input class="megapixels" type="number" min="0.001" step="0.01" title="Target megapixels (1 MP = 1,000,000 pixels). Start with 0.6 MP. Keeps the current ratio; dimensions are aligned to the pixel multiple."> MP</label></div>
        <div class="dimensions"><label>Width <input class="width" type="number" min="32" max="16384" step="32" title="Custom output width in pixels, rounded to the pixel multiple."></label>
        <button class="lock" title="Lock the width/height ratio for Custom dimensions." aria-pressed="true">Ratio locked</button>
        <label>Height <input class="height" type="number" min="32" max="16384" step="32" title="Custom output height in pixels, rounded to the pixel multiple."></label></div>
        <div class="scale-control"><span>−4x</span><input class="scale" type="range" min="-4" max="4" step="0.01" value="0" aria-label="Custom resolution scale" title="Scale width and height together: −4x divides by 4, center keeps the base size, +4x multiplies by 4. Editing MP or dimensions resets the base; reopening uses the applied size. Dimensions stay between the pixel multiple and 16384 pixels."><span>+4x</span><output class="scale-value">1.00x</output></div></div>
        <div><strong>Framing preview</strong><div class="stage"><img class="source" alt="Source frame for cropping"><div class="crop" role="slider" tabindex="0" aria-label="Crop position" title="Drag to reposition the crop. Arrow keys move it; Home centers it."></div></div>
        <p>Drag the green frame to adjust crop.</p><img class="result" alt="Resolution result"><div class="summary"></div></div></div>
        <div class="error" role="status"></div><footer><span>Applied to all image outputs</span><div><button class="cancel">Cancel</button> <button class="apply">Apply</button></div></footer>`;
    document.body.append(dialog);
    const get = (selector) => dialog.querySelector(selector);
    const button = root.querySelector(".resolution-button"), summary = root.querySelector(".resolution-summary");
    let draft, plan, locked = true, ratio = 1, request, timer, serial = 0;
    let baseWidth, baseHeight;
    let rawUrl, resultUrl, rawRequest, openSerial = 0, summaryRequest, summarySerial = 0;
    const defaultKey = "vkViggleResolutionDefault";
    const savedDefault = () => JSON.parse(localStorage.getItem(defaultKey) || "null");
    const defaults = () => ({multiple:32, megapixels:0.6, profile:"original", budget:"standard", format:"source", fit:"crop", width:640, height:384, x:0.5, y:0.5});
    const settings = () => widget.value ? {...defaults(), ...JSON.parse(widget.value)} : defaults();
    const describe = (item) => `${item.width} × ${item.height} · ${item.format === "source" ? "Source" : item.format} · ${(item.width * item.height / 1e6).toFixed(2)} MP`;
    const aligned = (value) => Math.max(draft.multiple, Math.min(Math.floor(16384 / draft.multiple) * draft.multiple, Math.round(value / draft.multiple) * draft.multiple));
    function resetScale() {
        baseWidth = aligned(draft.width); baseHeight = aligned(draft.height);
        get(".scale").value = 0;
        get(".scale-value").textContent = "1.00x";
        get(".scale").setAttribute("aria-valuetext", "1.00x");
    }
    function paintDimensions(width, height) {
        get(".width").value = width; get(".height").value = height;
        get(".megapixels").value = Number((width * height / 1e6).toFixed(3));
    }
    async function fetchPlan(config, signal) {
        const response = await api.fetchApi(context.endpoint("resolution", {resolution:JSON.stringify(config)}), {signal, cache:"no-store"});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Cannot calculate resolution.");
        return data;
    }
    function paint() {
        for (const group of Object.keys(groups)) {
            dialog.querySelectorAll(`[data-group="${group}"] button`).forEach((item) => {
                item.setAttribute("aria-pressed", String(item.dataset.value === draft[group]));
                item.disabled = group === "budget" ? draft.profile !== "viggle" :
                    (group === "format" || group === "fit") && draft.profile === "original";
            });
        }
        get(".width").disabled = get(".height").disabled = get(".lock").disabled =
            get(".megapixels").disabled = get(".scale").disabled = draft.profile !== "custom";
        get(".budget-mp").disabled = draft.profile !== "viggle" || draft.budget !== "custom";
        get(".budget-mp").value = draft.megapixels;
        get(".multiple").value = draft.multiple;
        for (const axis of ["width", "height"]) {
            get(`.${axis}`).min = draft.multiple; get(`.${axis}`).step = draft.multiple;
        }
        paintDimensions(plan.width, plan.height);
        const info = context.info();
        get(".stage").style.aspectRatio = `${info.width} / ${info.height}`;
        const [x, y, width, height] = plan.rect;
        Object.assign(get(".crop").style, {left:`${x / info.width * 100}%`,top:`${y / info.height * 100}%`,
            width:`${width / info.width * 100}%`,height:`${height / info.height * 100}%`});
        get(".crop").hidden = draft.profile === "original" || draft.fit !== "crop";
        get(".crop").setAttribute("aria-valuetext", `Horizontal ${Math.round(draft.x * 100)}%, vertical ${Math.round(draft.y * 100)}%`);
        get(".summary").textContent = `${info.width} × ${info.height} → ${describe(plan)} · ${Number(context.rate()) || info.fps} fps${draft.profile === "original" ? "" : ` · Aligned to ${draft.multiple} px`}`;
    }
    async function refresh() {
        clearTimeout(timer); request?.abort();
        const version = ++serial;
        request = new AbortController();
        get(".apply").disabled = true;
        get(".error").textContent = "";
        get(".result").removeAttribute("src");
        try {
            plan = await fetchPlan(draft, request.signal);
            if (version !== serial || !dialog.open) return;
            paint();
            const response = await api.fetchApi(context.endpoint("frame", {frame:context.frame(), resolution:JSON.stringify(draft)}), {signal:request.signal,cache:"no-store"});
            if (!response.ok) throw new Error((await response.json()).error || "Cannot preview resolution.");
            const blob = await response.blob();
            if (version !== serial || !dialog.open) return;
            if (resultUrl) URL.revokeObjectURL(resultUrl);
            resultUrl = URL.createObjectURL(blob); get(".result").src = resultUrl;
            get(".apply").disabled = false;
        } catch (error) { if (error.name !== "AbortError" && version === serial) get(".error").textContent = error.message; }
    }
    for (const group of Object.keys(groups)) {
        dialog.querySelectorAll(`[data-group="${group}"] button`).forEach((item) => {
            item.onclick = () => {
                draft[group] = item.dataset.value;
                if (group === "profile" && draft.profile === "custom") { draft.width = plan.width; draft.height = plan.height; ratio = plan.width / plan.height; }
                if (group === "format" && draft.profile === "custom") {
                    ratio = draft.format === "source" ? context.info().width / context.info().height : Number(draft.format.split(":")[0]) / Number(draft.format.split(":")[1]);
                    draft.height = aligned(draft.width / ratio);
                }
                if (group === "profile" || group === "format") resetScale();
                refresh();
            };
        });
    }
    for (const axis of ["width", "height"]) get(`.${axis}`).onchange = () => {
        draft[axis] = aligned(Number(get(`.${axis}`).value) || draft.multiple);
        if (locked) draft[axis === "width" ? "height" : "width"] = aligned(axis === "width" ? draft.width / ratio : draft.height * ratio);
        resetScale();
        refresh();
    };
    get(".default-videos").onchange = () => {
        if (get(".default-videos").checked && draft.profile !== "viggle") {
            draft.megapixels = plan.width * plan.height / 1e6;
            draft.profile = "viggle"; draft.budget = "custom"; refresh();
        }
    };
    get(".budget-mp").onchange = () => {
        const value = Number(get(".budget-mp").value);
        if (!Number.isFinite(value) || value <= 0) { get(".budget-mp").value = draft.megapixels; return; }
        draft.megapixels = value; refresh();
    };
    get(".multiple").onchange = () => {
        draft.multiple = Math.max(1, Math.min(16384, Math.round(Number(get(".multiple").value) || 32)));
        if (draft.profile === "custom") { draft.width = aligned(draft.width); draft.height = aligned(draft.height); }
        resetScale(); refresh();
    };
    get(".megapixels").onchange = () => {
        const megapixels = Number(get(".megapixels").value);
        if (!Number.isFinite(megapixels) || megapixels <= 0) { paintDimensions(plan.width, plan.height); return; }
        ratio = draft.width / draft.height;
        const width = Math.sqrt(megapixels * 1e6 * ratio), height = width / ratio;
        const limit = Math.min(1, 16384 / width, 16384 / height);
        draft.width = aligned(width * limit); draft.height = aligned(height * limit);
        resetScale(); refresh();
    };
    get(".scale").oninput = () => {
        const position = Number(get(".scale").value), factor = 4 ** (position / 4);
        const limited = Math.min(factor, 16384 / baseWidth, 16384 / baseHeight);
        draft.width = aligned(baseWidth * limited); draft.height = aligned(baseHeight * limited);
        get(".scale-value").textContent = position < 0 ? `÷${(1 / factor).toFixed(2)}` : `${factor.toFixed(2)}x`;
        get(".scale").setAttribute("aria-valuetext", get(".scale-value").textContent);
        paintDimensions(draft.width, draft.height);
        get(".apply").disabled = true;
        request?.abort(); ++serial; clearTimeout(timer); timer = setTimeout(refresh, 150);
    };
    get(".scale").onchange = refresh;
    get(".lock").onclick = () => { locked = !locked; ratio = plan.width / plan.height;
        get(".lock").setAttribute("aria-pressed", String(locked)); get(".lock").textContent = locked ? "Ratio locked" : "Ratio unlocked"; };
    const reposition = (x, y) => {
        draft.x = Math.max(0, Math.min(1, x)); draft.y = Math.max(0, Math.min(1, y));
        const info = context.info();
        plan.rect[0] = Math.round(draft.x * (info.width - plan.rect[2]));
        plan.rect[1] = Math.round(draft.y * (info.height - plan.rect[3]));
        paint(); get(".apply").disabled = true;
        request?.abort(); ++serial; clearTimeout(timer); timer = setTimeout(refresh, 150);
    };
    get(".crop").onpointerdown = (event) => {
        event.preventDefault();
        const crop = get(".crop"), startX = event.clientX, startY = event.clientY, x = draft.x, y = draft.y;
        const stage = get(".stage").getBoundingClientRect(), info = context.info();
        const roomX = stage.width * (1 - plan.rect[2] / info.width), roomY = stage.height * (1 - plan.rect[3] / info.height);
        crop.setPointerCapture(event.pointerId);
        crop.onpointermove = (move) => reposition(roomX ? x + (move.clientX - startX) / roomX : x, roomY ? y + (move.clientY - startY) / roomY : y);
        crop.onpointerup = crop.onpointercancel = () => { crop.onpointermove = null; refresh(); };
    };
    get(".crop").onkeydown = (event) => {
        if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home"].includes(event.key)) return;
        event.preventDefault();
        reposition(event.key === "Home" ? 0.5 : draft.x + (event.key === "ArrowLeft" ? -0.05 : event.key === "ArrowRight" ? 0.05 : 0),
            event.key === "Home" ? 0.5 : draft.y + (event.key === "ArrowUp" ? -0.05 : event.key === "ArrowDown" ? 0.05 : 0));
    };
    const updateSummary = async () => {
        summaryRequest?.abort(); const version = ++summarySerial;
        context.updateOptions();
        button.disabled = !context.info();
        if (!context.info()) { summary.textContent = ""; return; }
        if (!widget.value) { summary.textContent = "Current resize settings"; return; }
        summaryRequest = new AbortController();
        try { const data = await fetchPlan(settings(), summaryRequest.signal); if (version === summarySerial) summary.textContent = describe(data); }
        catch (error) { if (error.name !== "AbortError") summary.textContent = error.message; }
    };
    button.onclick = async () => {
        const version = ++openSerial;
        rawRequest?.abort(); rawRequest = new AbortController();
        draft = settings(); get(".default-videos").checked = Boolean(savedDefault()); locked = true; ratio = draft.width / draft.height; resetScale();
        get(".lock").textContent = "Ratio locked"; get(".lock").setAttribute("aria-pressed","true");
        dialog.showModal(); get(".apply").disabled = true;
        get(".source").removeAttribute("src");
        refresh();
        try {
            const response = await api.fetchApi(context.endpoint("frame", {frame:context.frame(), resolution:"", longest:0, shortest:0, resize_mode:"none"}),{signal:rawRequest.signal});
            if (!response.ok) throw new Error("Cannot read source frame.");
            const blob = await response.blob();
            if (!dialog.open || version !== openSerial) return;
            if (rawUrl) URL.revokeObjectURL(rawUrl);
            rawUrl = URL.createObjectURL(blob); get(".source").src = rawUrl;
        } catch (error) { if (error.name !== "AbortError" && version === openSerial) get(".error").textContent = error.message; }
    };
    get(".apply").onclick = () => {
        draft.width = plan.width; draft.height = plan.height;
        widget.value = JSON.stringify(draft);
        if (get(".default-videos").checked) {
            const megapixels = draft.profile === "viggle" ? draft.budget === "custom" ? draft.megapixels :
                {test:0.4, standard:0.6, detail:1.2}[draft.budget] : plan.width * plan.height / 1e6;
            localStorage.setItem(defaultKey, JSON.stringify({...draft, profile:"viggle", budget:"custom", megapixels, x:0.5, y:0.5}));
        } else localStorage.removeItem(defaultKey);
        context.apply(); updateSummary(); node.graph?.setDirtyCanvas(true,true); dialog.close();
    };
    get(".close").onclick = get(".cancel").onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
        if (dialog.open) return;
        request?.abort(); rawRequest?.abort(); ++serial; ++openSerial; clearTimeout(timer);
    });
    const callback = widget.callback;
    widget.callback = function () { callback?.apply(this,arguments); context.apply(); updateSummary(); };
    return {updateSummary, applyDefault() {
        const saved = savedDefault();
        if (saved) widget.value = JSON.stringify({...defaults(), ...saved});
    }, dispose() {
        dialog.close(); dialog.remove(); request?.abort(); rawRequest?.abort(); summaryRequest?.abort(); ++serial; ++summarySerial; ++openSerial; clearTimeout(timer);
        if (rawUrl) URL.revokeObjectURL(rawUrl); if (resultUrl) URL.revokeObjectURL(resultUrl);
    }};
}
