import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { buildResolutionUI } from "./video_resolution.js";
import { buildChunkGuidesUI } from "./chunk_guides.js";

export function frameAtTime(times, time) {
    let low = 0, high = times.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (times[middle] <= time + 0.000001) low = middle + 1;
        else high = middle;
    }
    return Math.max(1, low);
}

export function chunkSpans(frameCount, chunkFrames) {
    if (frameCount <= 0) return [];
    const total = 2 + 5 * Math.ceil((Math.max(5, frameCount) - 5) / 17);
    const window = 2 + 5 * Math.floor((chunkFrames - 5) / 17);
    if (window < 7) return [];
    const frameAtLatent = (index) => 17 * Math.floor(index / 5) + [0, 1, 5, 9, 13][index % 5];
    if (window >= total) return [{first:0, last:frameCount - 1, generatedLast:frameAtLatent(total) - 1}];
    const starts = [];
    for (let start = 0; start <= total - window; start += window - 2) starts.push(start);
    if (starts.at(-1) !== total - window) starts.push(total - window);
    return starts.map((start) => ({first:Math.min(frameCount - 1,frameAtLatent(start)),
        last:Math.min(frameCount - 1,frameAtLatent(start + window) - 1), generatedLast:frameAtLatent(start + window) - 1}));
}

export function formatVideoTime(seconds) {
    const milliseconds = Math.max(0, Math.round(seconds * 1000));
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2,"0")}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2,"0")}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2,"0")}.${String(milliseconds % 1000).padStart(3,"0")}`;
}

function styles() {
    if (document.getElementById("vk-viggle-loader-style")) return;
    const style = document.createElement("style");
    style.id = "vk-viggle-loader-style";
    style.textContent = `
        .vk-viggle-loader { display:flex; flex-direction:column; gap:8px; padding:8px;
            box-sizing:border-box; background:#191b20; color:#ddd; font:12px sans-serif;
            width:100%; height:100%; min-height:0; overflow:auto; border-radius:8px; }
        .vk-viggle-loader > * { flex-shrink:0; }
        .vk-viggle-loader video { width:100%; height:0; min-height:120px; flex:1 1 0;
            object-fit:contain; background:#08090b; }
        .vk-viggle-loader .controls { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
        .vk-viggle-loader button { border:1px solid #555; border-radius:5px; padding:6px 10px;
            background:#30343e; color:#eee; cursor:pointer; }
        .vk-viggle-loader button:disabled { opacity:.45; cursor:default; }
        .vk-viggle-loader .guide-add-bar button.guide-reference-toggle { background:#e99c9c; border-color:#f4b5b5; color:#29191b; font-weight:bold; }
        .vk-viggle-loader .loader-options { border:1px solid #454952; border-radius:8px; padding:8px 10px; }
        .vk-viggle-loader .option-fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin:10px 0; }
        .vk-viggle-loader .option-fields label { display:flex; flex-direction:column; gap:5px; }
        .vk-viggle-loader .option-fields input,.vk-viggle-loader .option-fields select { width:100%; min-width:0; box-sizing:border-box; }
        .vk-viggle-loader .loader-options input:not([type=checkbox]),.vk-viggle-loader .loader-options select { background:#30343e; color:#eee; border:1px solid #555; border-radius:5px; padding:6px; }
        .vk-viggle-loader .guide-settings { display:grid; grid-template-columns:1fr 1fr; gap:7px; border-top:1px solid #454952; margin-top:8px; padding-top:8px; }
        .vk-viggle-loader .guide-settings label:has(input[type=checkbox]),.vk-viggle-loader .guide-settings > .option-hint,.vk-viggle-loader .guide-settings > .controls { grid-column:1/-1; }
        .vk-viggle-loader .guide-settings > label:first-child { flex-wrap:wrap; }
        .vk-viggle-loader .guide-settings select { max-width:100%; }
        .vk-viggle-loader .guide-settings label { display:flex; align-items:center; gap:6px; }
        .vk-viggle-loader input[type=checkbox] { accent-color:#69a5ff; }
        .vk-viggle-loader .option-hint { color:#a9b2c1; font-size:11px; }
        .vk-viggle-loader .preview-modes { display:flex; gap:4px; }
        .vk-viggle-loader .preview-modes button { flex:1; padding:6px 4px; }
        .vk-viggle-loader .scroll { overflow-x:scroll; flex-shrink:0; }
        .vk-viggle-loader .show-cut { display:grid; place-items:center; }
        .vk-viggle-loader .show-cut span,.vk-viggle-loader .show-cut::after { grid-area:1 / 1; }
        .vk-viggle-loader .show-cut::after { content:"Show original video"; visibility:hidden; }
        .vk-viggle-loader .track { position:relative; min-width:100%; height:66px; cursor:crosshair; }
        .vk-viggle-loader .thumb { position:absolute; top:0; width:100px; height:56px;
            background-repeat:no-repeat; background-size:auto 56px; }
        .vk-viggle-loader .marker { position:absolute; top:0; bottom:0; width:2px;
            pointer-events:none; z-index:2; }
        .vk-viggle-loader .cut-marker { background:#48e084; z-index:3; }
        .vk-viggle-loader .excluded { position:absolute; top:0; bottom:0; background:#191b20bb;
            backdrop-filter:grayscale(1); pointer-events:none; z-index:1; }
        .vk-viggle-loader .requested-end { background:#aaa; }
        .vk-viggle-loader .upload-row { flex-wrap:nowrap; }
        .vk-viggle-loader .video-info { font-size:11px; flex:1; }
        .vk-viggle-loader .cut-summary { color:#b9e9c9; }
        .vk-viggle-loader .quick { position:relative; }
        .vk-viggle-loader .quick-markers { position:relative; min-height:22px; }
        .vk-viggle-loader .chunk-markers,.vk-viggle-loader .chunk-timeline-markers,.vk-viggle-loader .guide-markers,.vk-viggle-loader .guide-timeline-markers { display:contents; }
        .vk-viggle-loader .quick-symbol { position:absolute; top:0; color:#48e084;
            font-weight:bold; transform:translateX(-50%); background:none; border:0;
            padding:0; min-width:18px; height:18px; cursor:pointer; }
        .vk-viggle-loader .navigation { display:flex; justify-content:space-between; }
        .vk-viggle-loader .chunk-symbol,.vk-viggle-loader .guide-symbol { min-width:6px; width:6px; z-index:1; }
        .vk-viggle-loader .chunk-symbol::before,.vk-viggle-loader .guide-symbol::before { content:""; position:absolute; left:2px; top:2px;
            bottom:2px; width:2px; background:#ffd54a; pointer-events:none; }
        .vk-viggle-loader .guide-symbol::before { background:#69a5ff; }
        .vk-viggle-loader .reference-symbol { min-width:10px; width:10px; z-index:4; }
        .vk-viggle-loader .reference-symbol::before { content:""; position:absolute; left:2px; top:0; bottom:0; width:6px; background:#ff6b6b; pointer-events:none; }
        .vk-viggle-loader .chunk-timeline-marker { background:#ffd54a; }
        .vk-viggle-loader .guide-timeline-marker { background:#69a5ff; z-index:3; }
        .vk-viggle-loader .reference-timeline-marker { width:6px; margin-left:-3px; background:#ff6b6b; z-index:5; }
        .vk-viggle-loader .playhead { background:#fff; opacity:.8; }
        .vk-viggle-loader .chunk-range { position:absolute; bottom:0; height:7px; background:#69a5ff; pointer-events:none; z-index:4; }
        .vk-viggle-loader .chunk-guides { border-top:1px solid #454952; padding-top:8px; }
        .vk-viggle-loader .chunk-navigation { justify-content:space-between; }
        .vk-viggle-loader .chunk-label { flex:1; text-align:center; }
        .vk-viggle-loader .guide-gallery { margin:6px 0; }
        .vk-viggle-loader .guide-thumb-image { display:block; background-repeat:no-repeat; }
        .vk-viggle-loader .guide-thumb-caption { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:4px; white-space:pre-line; }
        .vk-viggle-loader .guide-thumb-references { display:flex; flex:none; gap:3px; }
        .vk-viggle-loader .guide-thumb-angle { display:flex; flex-direction:column; align-items:center; width:48px; gap:3px; white-space:normal; overflow-wrap:anywhere; text-align:center; }
        .vk-viggle-loader .guide-thumb-references img { width:36px; height:48px; object-fit:contain; background:#191b20; border-radius:3px; }
        .vk-viggle-loader .guide-thumb[data-reference=true] { border-color:#e99c9c; background:#573636; }
        .vk-viggle-loader .guide-thumb[aria-pressed=true] { border-color:#69a5ff; background:#263d60; }
        .vk-viggle-loader .guide-thumb[data-reference=true][aria-pressed=true] { border-color:#f4b5b5; background:#e99c9c; color:#29191b; }
        .vk-viggle-loader .guide-thumb[data-reference=true][aria-pressed=true] .guide-customized { color:#7a2020 !important; }
        .vk-viggle-loader .guide-status { margin-top:4px; color:#b6c9e4; }
        .vk-viggle-loader .guide-auto-frames { width:65px; }
        .vk-viggle-loader .chunk-guides select,.vk-viggle-loader .guide-auto-frames { background:#30343e; color:#eee; border:1px solid #555; border-radius:4px; padding:5px; }
        .vk-viggle-loader input[type=range] { width:100%; margin:0; accent-color:#aaa; }
        .vk-viggle-loader .status { min-height:16px; overflow-wrap:anywhere; padding:8px; border-radius:5px; background:#263449; }
        .vk-viggle-loader .status:empty { display:none; }
        .vk-viggle-loader .status[data-error=true] { background:#512c30; color:#ffd2d2; }
        .vk-viggle-loader .status[aria-busy=true]::before { content:""; display:inline-block; width:10px; height:10px; margin-right:8px; border:2px solid #ffffff44; border-top-color:#8fc4ff; border-radius:50%; vertical-align:middle; animation:vk-video-loading 1s linear infinite; }
        @keyframes vk-video-loading { to { transform:rotate(360deg); } }
        .vk-viggle-export-dialog { background:#191b20; color:#ddd; border:1px solid #555;
            border-radius:8px; padding:12px; width:90vw; max-width:1200px; }
        .vk-viggle-export-dialog::backdrop { background:#000b; }
        .vk-viggle-export-dialog header { display:flex; justify-content:space-between; align-items:center; gap:12px; }
        .vk-viggle-export-dialog button { cursor:pointer; }
        .vk-viggle-loader { container-type:inline-size; }
        .vk-viggle-loader .loader-workspace { display:grid; grid-template-columns:minmax(0,2fr) minmax(220px,1fr); gap:14px; }
        .vk-viggle-loader .loader-viewer,.vk-viggle-loader .loader-sidebar { min-width:0; display:flex; flex-direction:column; gap:8px; }
        .vk-viggle-loader .loader-sidebar { padding-right:4px; }
        .vk-viggle-loader .loader-viewer video { flex:none; height:260px; min-height:180px; border-radius:6px; }
        .vk-viggle-loader .guide-editor { border:1px solid #454952; border-radius:8px; padding:10px; }
        .vk-viggle-loader .guide-editor-fields { display:flex; flex-direction:column; gap:9px; margin-top:10px; }
        .vk-viggle-loader .guide-angle-slot label { display:flex; flex-direction:column; gap:5px; min-width:0; }
        .vk-viggle-loader .guide-editor .editor-check { flex-direction:row; align-items:center; }
        .vk-viggle-loader .guide-editor select,.vk-viggle-loader .guide-editor textarea { background:#30343e; color:#eee; border:1px solid #555; border-radius:5px; padding:6px; width:100%; box-sizing:border-box; font:12px sans-serif; }
        .vk-viggle-loader .guide-editor textarea { resize:vertical; min-height:120px; }
        .vk-viggle-loader .editor-tabs button { flex:1; }
        .vk-viggle-loader .guide-editor button[aria-pressed=true] { background:#263d60; border-color:#69a5ff; }
        .vk-viggle-loader .guide-prompt .controls { justify-content:space-between; margin-bottom:5px; }
        .vk-viggle-loader .guide-prompt button { font-size:11px; padding:3px 5px; }
        .vk-viggle-loader .guide-editor [hidden] { display:none; }
        .vk-viggle-loader .guide-gallery { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); grid-auto-rows:max-content; align-items:start; gap:6px; overflow:visible; }
        .vk-viggle-loader .guide-thumb-image { flex:none; width:min(100%,320px); height:auto; aspect-ratio:16/9; align-self:center; overflow:hidden; }
        .vk-viggle-loader .guide-thumb-label { min-width:0; text-align:left; overflow-wrap:anywhere; }
        .vk-viggle-loader .guide-pagination { justify-content:space-between; }
        .vk-viggle-loader .guide-page-label { flex:1; text-align:center; }
        .vk-viggle-loader .guide-reference-toggle { align-self:center; white-space:nowrap; }
        .vk-viggle-loader .guide-add-bar button.guide-reference-toggle[aria-pressed=true] { background:#ffb4b4; border-color:#fff; box-shadow:inset 0 0 0 2px #914747; }
        .vk-viggle-loader .guide-add-bar button.guide-reference-toggle[aria-pressed=false][data-has-reference=true] { background:#a58080; border-color:#b99a9a; }
        .vk-viggle-loader .guide-borrowed-reference-warning { color:#ff3333; }
        .vk-viggle-loader .guide-reference-warning { flex-basis:100%; color:#ff6b6b; }
        .vk-viggle-loader .guide-reference-warning[hidden] { display:none; }
        .vk-viggle-loader .guide-actions { flex-wrap:nowrap; overflow-x:auto; }
        .vk-viggle-loader .guide-actions button { white-space:nowrap; flex:0 0 auto; padding:6px; }
        .vk-viggle-loader .guide-add-buttons { display:flex; flex-wrap:nowrap; gap:6px; overflow-x:auto; width:100%; }
        .vk-viggle-loader .guide-add-buttons button { white-space:nowrap; flex:0 0 auto; }
        .vk-viggle-loader .guide-add-bar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; border-top:1px solid #454952; padding:10px 0; }
        .vk-viggle-loader .guide-add-bar button { background:#263d60; }
        .vk-viggle-loader .player-header { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .vk-viggle-loader .player-resolution { margin-left:auto; display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
        .vk-viggle-loader .player-resolution .resolution-summary { font-size:11px; }
        .vk-viggle-loader .guide-interval-popup { width:min(360px,85vw); background:#22252d; color:#eee; border:1px solid #666; border-radius:8px; padding:16px; box-shadow:0 8px 30px #0009; }
        .vk-viggle-loader .guide-interval-popup:popover-open { display:flex; flex-direction:column; gap:12px; }
        .vk-viggle-loader .guide-interval-popup header { display:flex; justify-content:space-between; align-items:center; gap:15px; }
        .vk-viggle-loader .guide-add-character { color:#b6c9e4; margin:0; text-align:center; width:90px; align-self:center; }
        .vk-viggle-loader .guide-add-character img { width:90px; height:74px; object-fit:contain; display:block; margin:auto; }
        .vk-viggle-loader .guide-add-character span { height:74px; display:grid; place-items:center; color:#eab96a; }
        .vk-viggle-loader .guide-add-character [hidden] { display:none; }
        .vk-viggle-loader .guide-add-character figcaption { overflow-wrap:anywhere; margin-top:3px; }
        .vk-viggle-loader .guide-interval-popup label { display:flex; align-items:center; gap:6px; }
        .vk-viggle-loader .guide-interval-popup select { background:#30343e; color:#eee; border:1px solid #555; border-radius:5px; padding:6px; }
        .vk-viggle-loader .guide-new-controls { flex-basis:100%; min-width:0; display:grid; grid-template-columns:minmax(0,1fr) auto 90px; gap:12px; align-items:start; }
        .vk-viggle-loader .guide-new-angles { min-width:0; display:flex; flex-direction:column; gap:8px; align-items:stretch; }
        .vk-viggle-loader .guide-new-angle-group { display:flex; flex-wrap:nowrap; align-items:center; gap:8px; }
        .vk-viggle-loader .guide-new-angles .guide-angle-buttons { margin-top:0; }
        .vk-viggle-loader .guide-new-angle-group > span { flex:0 0 76px; }
        .vk-viggle-loader .guide-new-prompt { display:flex; align-items:center; gap:8px; margin-left:12px; }
        .vk-viggle-loader .guide-new-prompt input { width:300px; max-width:35vw; min-width:100px; background:#30343e; color:#eee; border:1px solid #555; border-radius:5px; padding:6px; }
        .vk-viggle-loader .guide-add-bar :is(.guide-prompt-shortcuts,.guide-prompt-save,.guide-prompt-reset) { flex:0 0 30px; padding:5px; background:#30343e; }
        .vk-viggle-loader .cut-controls,.vk-viggle-loader .playback-controls { flex-wrap:nowrap; align-items:stretch; }
        .vk-viggle-loader .cut-controls button,.vk-viggle-loader .playback-controls button { flex:1; min-width:0; padding:6px 3px; }
        .prompt-shortcuts-manager,.prompt-shortcuts-picker { background:#22252d; color:#eee; border:1px solid #666; border-radius:8px; padding:16px; box-shadow:0 8px 30px #0009; max-height:75vh; overflow:auto; font:14px sans-serif; }
        .prompt-shortcuts-manager { width:min(650px,85vw); }
        .prompt-shortcuts-tabs { display:flex; gap:6px; margin-bottom:12px; }
        .prompt-shortcuts-tabs button { flex:1; padding:7px; }
        .prompt-shortcuts-tabs button[aria-selected=true] { background:#263d60; color:#eee; border-color:#69a5ff; }
        .prompt-shortcuts-manager header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .prompt-shortcuts-manager p { color:#aeb8c8; font-size:12px; }
        .prompt-shortcut-row { display:flex; gap:6px; margin-bottom:6px; }
        .prompt-shortcut-row input { flex:1; min-width:0; background:#30343e; color:#eee; border:1px solid #555; border-radius:5px; padding:6px; }
        .prompt-shortcuts-picker { width:min(420px,85vw); }
        .prompt-shortcuts-picker label { display:flex; align-items:center; gap:8px; margin:10px 0; overflow-wrap:anywhere; }
        .vk-viggle-loader .guide-mask-toggle { display:flex; align-items:center; gap:8px; }
        .vk-viggle-loader .guide-mask-toggle input { appearance:none; width:32px; height:18px; border-radius:10px; background:#555; cursor:pointer; position:relative; }
        .vk-viggle-loader .guide-mask-toggle input:checked { background:#8064c1; }
        .vk-viggle-loader .guide-mask-toggle input::after { content:""; position:absolute; width:12px; height:12px; left:3px; top:3px; border-radius:50%; background:#eee; }
        .vk-viggle-loader .guide-mask-toggle input:checked::after { left:17px; }
        .vk-viggle-loader .guide-angle-buttons { display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; }
        .vk-viggle-loader .guide-angle-buttons button[aria-pressed=true] { border-color:#a68aff; background:#463b62; }
        .vk-viggle-loader .guide-angle-preview { position:fixed; inset:auto; margin:0; padding:6px; max-width:180px; background:#22252d; color:#eee; border:1px solid #666; border-radius:6px; box-shadow:0 6px 20px #0009; pointer-events:none; text-align:center; font:12px sans-serif; }
        .vk-viggle-loader .guide-angle-preview img { display:block; width:160px; height:180px; object-fit:contain; margin-bottom:5px; }
        .vk-viggle-loader .guide-prompts { display:grid; grid-template-columns:repeat(var(--guide-columns,3),minmax(0,1fr)); gap:10px; align-items:start; }
        .vk-viggle-loader .guide-prompt,.vk-viggle-loader .guide-mask-settings { min-width:0; }
        .vk-viggle-loader .guide-mask-settings { display:flex; flex-direction:column; gap:7px; }
        .vk-viggle-loader .guide-mask-settings > label { display:flex; flex-direction:row; gap:5px; }
        .vk-viggle-loader .guide-editor-header { display:flex; flex-wrap:wrap; align-items:center; gap:8px 18px; }
        .vk-viggle-loader .guide-editor-header label { display:flex; align-items:center; gap:8px; }
        .vk-viggle-loader .guide-editor-header select { width:auto; min-width:150px; }
        .vk-viggle-loader .guide-role-column { display:flex; flex-direction:column; gap:8px; min-width:0; }
        .vk-viggle-loader .guide-editor-fields textarea { min-height:90px; }
        .vk-viggle-loader .guide-editor .editor-tabs { flex-wrap:wrap; }
        .vk-viggle-loader .loader-timeline { display:flex; flex-direction:column; gap:8px; min-width:0; }
        .vk-viggle-loader .loader-options .option-fields { gap:6px; }
        .vk-viggle-loader .loader-options .preview-option { grid-column:1/-1; }
        .vk-viggle-loader h2 { font-size:20px; margin:4px 0 10px; font-weight:650; }
        .vk-viggle-loader .guide-workspace { display:grid; grid-template-columns:minmax(0,1fr); gap:14px; }
        .vk-viggle-loader .guide-editor { min-width:0; }
        .vk-viggle-loader .guide-save-options { border-top:1px solid #454952; padding-top:10px; }
        .vk-viggle-loader .guide-defaults { display:flex; flex-direction:column; gap:16px; }
        .vk-viggle-loader .guide-default-card { border-top:1px solid #454952; padding-top:12px; display:flex; flex-direction:column; gap:8px; }
        .vk-viggle-loader .guide-default-card .guide-prompts { grid-template-rows:auto auto auto auto; }
        .vk-viggle-loader .guide-default-card .guide-role-column,.vk-viggle-loader .guide-default-card .guide-mask-settings { display:grid; grid-row:span 4; grid-template-rows:subgrid; row-gap:inherit; }
        .vk-viggle-loader .guide-default-card .guide-prompt { display:contents; }
        .vk-viggle-loader .editor-tabs button { font-size:16px; font-weight:600; }
        .vk-viggle-video-history { width:min(650px,85vw); max-height:80vh; overflow:auto; background:#191b20; color:#ddd; border:1px solid #555; border-radius:8px; }
        .vk-viggle-video-history::backdrop { background:#000b; }
        .vk-viggle-video-history header { display:flex; justify-content:space-between; align-items:center; }
        .vk-viggle-video-history .history-list { display:flex; flex-direction:column; gap:6px; }
        .vk-viggle-video-history button { cursor:pointer; padding:8px; background:#30343e; border:1px solid #555; border-radius:5px; color:#eee; text-align:left; }
        .vk-viggle-video-history .history-list > button { display:flex; align-items:center; gap:12px; }
        .vk-viggle-video-history .history-preview { width:160px; height:90px; flex:none; background:#08090b; border-radius:4px; overflow:hidden; display:grid; place-items:center; }
        .vk-viggle-video-history .history-preview img { width:100%; height:100%; object-fit:contain; }
        .vk-viggle-video-history .history-preview span { font-size:11px; color:#a9b2c1; }
        .vk-viggle-video-history .history-preview [hidden] { display:none; }
        .vk-viggle-video-history .history-description { min-width:0; overflow-wrap:anywhere; }
        .vk-viggle-video-history small { display:block; margin-top:4px; color:#b6c9e4; }
        @container (max-width:950px) { .vk-viggle-loader .loader-workspace { grid-template-columns:minmax(0,1.2fr) minmax(260px,1fr); } .vk-viggle-loader .loader-sidebar { grid-column:1/-1; } .vk-viggle-loader .guide-gallery { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @container (max-width:700px) { .vk-viggle-loader .guide-workspace { grid-template-columns:1fr; } .vk-viggle-loader .guide-gallery { grid-template-columns:repeat(3,minmax(0,1fr)); } }
        @container (max-width:460px) { .vk-viggle-loader .guide-prompts { grid-template-columns:1fr; } .vk-viggle-loader .guide-gallery { grid-template-columns:repeat(2,minmax(0,1fr)); } }
        @container (max-width:700px) { .vk-viggle-loader .loader-workspace { grid-template-columns:1fr; } }
    `;
    document.head.append(style);
}

function buildPlayer(node) {
    const widget = (name) => node.widgets.find((item) => item.name === name);
    const source = widget("video");
    source.hidden = true;
    const chosen = widget("selected_frame_number");
    chosen.hidden = true;
    const frameSpace = widget("reference_frame_space");
    frameSpace.hidden = true;
    const startWidget = widget("start_time"), endWidget = widget("end_time");
    const capWidget = widget("frame_load_cap"), rateWidget = widget("force_rate");
    const chunkWidget = widget("chunk_frames");
    node.properties ??= {};
    node.properties.vkViggleHasReference ??= Number(chosen.value) > 1;
    for (const name of ["longest_side", "shortest_side", "resize_mode"]) widget(name).hidden = true;
    const root = document.createElement("div");
    root.className = "vk-viggle-loader";
    root.innerHTML = `<video preload="metadata" playsinline></video>
        <div class="preview-modes" role="group" aria-label="Player navigation">
        <button data-mode="first" title="Seek the player to the first loaded frame; keep guide selections unchanged.">First Frame</button>
        <button data-mode="last" title="Seek the player to the last loaded frame; keep guide selections unchanged.">Last Frame</button>
        <div class="player-resolution"><span class="resolution-summary"></span><button class="resolution-button" disabled title="Choose output resolution, format, Crop or Pad and preview before applying.">Resolution…</button></div></div>
        <div class="controls upload-row"><button class="upload">Upload Video</button><button class="previous-video">Previous Video</button><span class="video-info"></span></div>
        <section class="loader-options"><h2>Options</h2>
        <div class="option-fields"></div>
        <div class="guide-settings"></div></section>
        <div class="controls playback-controls"><button class="play" disabled>Play</button><button class="stop" disabled>Stop</button>
        <button class="guide-back" disabled title="Seek one loaded frame backward.">−1 Frame</button><button class="guide-forward" disabled title="Seek one loaded frame forward.">+1 Frame</button>
        <button class="select" disabled title="Seek to the inspected chunk’s own reference frame. Disabled when this chunk borrows another chunk’s reference.">Chunk Ref Frame</button></div>
        <div class="controls cut-controls"><button class="mark-start" disabled>Mark Start</button>
        <button class="mark-end" disabled>Mark End</button><button class="reset" disabled>Reset</button>
        <button class="show-cut" disabled title="Fit the timeline and thumbnails to the effective cut. Toggle back to inspect the shaded source regions and extend the cut."><span>Show only cut</span></button>
        <button class="export-cut" disabled title="Save the effective cut as MP4 with processing resolution, FPS, frame cap and source audio. Choose the destination file.">Export cut</button></div>
        <div class="cut-summary">Cut: — frames · — s</div><div class="position">Frame 1 · Chunks: —</div>
        <div class="position-time" title="Selector timestamp in the original source video / full source-video duration.">00:00:00.000 / —</div>
        <div class="loaded-position">Loaded frame: —</div>
        <div class="chunk-timing"></div>
        <div class="scroll"><div class="track"><div class="marker playhead"></div><span class="chunk-timeline-markers"></span>
        <div class="excluded excluded-start" hidden></div><div class="excluded excluded-end" hidden></div>
        <div class="marker requested-end" title="User end marker; frame cap ends the loaded video earlier" hidden></div>
        <div class="marker cut-marker cut-start" title="Cut start" hidden></div>
        <div class="marker cut-marker cut-end" title="Marked end (inclusive frame)" hidden></div></div></div>
        <div class="navigation"><button class="timeline-prev" title="Scroll thumbnails left">‹</button>
        <button class="timeline-next" title="Scroll thumbnails right">›</button></div>
        <div class="quick"><input class="seek" type="range" min="1" max="1" step="1" value="1" disabled aria-label="Loaded frame timeline">
        <div class="quick-markers">
        <button type="button" class="quick-symbol quick-start" title="Effective cut start" aria-label="Go to cut start" disabled>▶</button>
        <button type="button" class="quick-symbol quick-end" title="Effective cut end" aria-label="Go to cut end" disabled>◀</button><span class="chunk-markers"></span></div></div>
        <div class="status" role="status"></div>`;
    const get = (selector) => root.querySelector(selector);
    const workspace = document.createElement("div"); workspace.className = "loader-workspace";
    const viewer = document.createElement("div"); viewer.className = "loader-viewer";
    const sidebar = document.createElement("aside"); sidebar.className = "loader-sidebar";
    for (const child of [...root.children]) {
        if (child.classList.contains("loader-options")) sidebar.append(child);
        else if (!child.classList.contains("status")) viewer.append(child);
    }
    viewer.prepend(viewer.querySelector(".upload-row"));
    const timelinePanel = document.createElement("section"); timelinePanel.className = "loader-timeline";
    for (const selector of [".scroll", ".navigation", ".quick"]) timelinePanel.append(viewer.querySelector(selector));
    workspace.append(viewer,sidebar); root.prepend(workspace); workspace.after(timelinePanel);
    const heading = document.createElement("h2"); heading.textContent = "Video";
    const playerHeader = document.createElement("header"); playerHeader.className = "player-header";
    playerHeader.append(heading,get(".player-resolution")); viewer.prepend(playerHeader);
    const player = get("video"), slider = get(".seek"), track = get(".track");
    const play = get(".play"), stop = get(".stop");
    const markStart = get(".mark-start"), markEnd = get(".mark-end");
    const reset = get(".reset");
    const exportButton = get(".export-cut");
    const showCutButton = get(".show-cut");
    let showOnlyCut = Boolean(node.properties.vkViggleShowOnlyCut);
    showCutButton.firstElementChild.textContent = showOnlyCut ? "Show original video" : "Show only cut";
    showCutButton.setAttribute("aria-pressed", String(showOnlyCut));
    let exporting = false, exportController, exportUrl;
    const exportDialog = document.createElement("dialog");
    exportDialog.className = "vk-viggle-export-dialog";
    exportDialog.setAttribute("aria-label", "Save exported cut");
    exportDialog.innerHTML = '<header><strong>Save exported cut</strong><form method="dialog"><button>Close</button></form></header><p>Right-click the link and choose “Save link as…” to select the destination.</p><a>Save exported cut…</a>';
    document.body.append(exportDialog);
    const status = get(".status");
    let statusTimer;
    function setStatus(message, busy = false, error = false) {
        clearInterval(statusTimer);
        status.textContent = message;
        status.setAttribute("aria-busy", String(busy));
        status.dataset.error = String(error);
        if (busy) {
            const started = performance.now(), elapsed = document.createElement("span");
            elapsed.setAttribute("aria-hidden", "true");
            status.append(elapsed);
            const tick = () => { elapsed.textContent = ` · ${Math.floor((performance.now() - started) / 1000)} s`; };
            tick(); statusTimer = setInterval(tick, 1000);
        }
    }
    get(".upload").title = "Upload a video into the ComfyUI input directory. New videos select frame 1.";
    play.title = "Play or pause the effective cut without changing the selected frame.";
    stop.title = "Stop playback and return to the cut start; keep the selected frame.";
    markStart.title = "Start at the displayed frame, including source frames inspected outside the cut. Keep at least 5 loaded frames.";
    markEnd.title = "End after the displayed frame, including source frames inspected outside the cut. Keep at least 5 loaded frames.";
    reset.title = "Remove the cut and frame cap to restore the entire video; keep guide and chunk reference selections.";
    track.title = "Click inside the cut to inspect loaded frames and their chunk. Click a shaded region to inspect a source frame and reposition Mark Start or Mark End. Playback stays inside the effective cut.";
    let times = [], seekTimes = [], currentSource, sourceInfo, duration = 0, generation = 0, cursorFrame = 1, disposed = false;
    let browserPlayback = true, preparing = true;
    let infoController, thumbnailsController;
    let sheetUrl, sheetKey, animation, seekAnimation, pendingSeek, cutTimer, cutController, cutVersion = 0;
    let loadedStart = 0, selectionTime, acceptedCut, cutNotice;
    let spansKey, spans = [], spanStarts = [];
    function loadedSpans() {
        const key = `${times.length}:${chunkWidget.value}`;
        if (key !== spansKey) {
            spansKey = key;
            spans = chunkSpans(times.length, Number(chunkWidget.value));
            spanStarts = spans.map(span => span.first + 1);
        }
        return spans;
    }
    let inspectionFrame = null;
    function clearInspection() {
        inspectionFrame = null;
    }
    function inspectSource(frame) {
        player.pause(); inspectionFrame = frame;
        scheduleSeek(sourceInfo.times[frame - 1]);
        drawPosition();
    }
    const displayedFrame = () => cursorFrame;

    function cutPlan() {
        return {start:loadedStart, end:loadedStart + duration, first:1, last:times.length,
            count:times.length, seconds:duration};
    }

    function nearestFrame(time) {
        const frame = frameAtTime(times, time);
        return frame < times.length && Math.abs(times[frame] - time) <= Math.abs(times[frame - 1] - time) ? frame + 1 : frame;
    }

    function drawTimeline() {
        if (!times.length) return;
        const cut = cutPlan();
        const marked = node.properties.vkViggleStartMarked || Number(startWidget.value) > 0;
        const capped = Number(capWidget.value) > 0;
        const start = timelineFraction(loadedStart);
        const end = timelineFraction(cut.end);
        get(".cut-start").style.left = `calc(${start * 100}% - 1px)`;
        get(".cut-end").style.left = `calc(${end * 100}% - 1px)`;
        get(".cut-start").hidden = !marked && !capped;
        get(".cut-end").hidden = !marked && !capped;
        get(".cut-end").title = `Effective end: ${cut.end.toFixed(3)} s · ${cut.count} loaded frames`;
        get(".excluded-start").hidden = start <= 0;
        get(".excluded-start").style.width = `${start * 100}%`;
        get(".excluded-start").style.left = "0";
        get(".excluded-end").hidden = end >= 1;
        get(".excluded-end").style.left = `${end * 100}%`;
        get(".excluded-end").style.width = `${(1 - end) * 100}%`;
        const requestedEnd = Math.min(sourceInfo.duration, Number(endWidget.value) || sourceInfo.duration);
        get(".requested-end").hidden = showOnlyCut || !capped || !Number(endWidget.value) || requestedEnd <= cut.end + 0.000001;
        get(".requested-end").style.left = `calc(${timelineFraction(requestedEnd) * 100}% - 1px)`;
        for (const marker of get(".chunk-timeline-markers").children) {
            marker.style.left = `calc(${fraction(Number(marker.dataset.frame)) * 100}% - 2px)`;
        }
        guidesUI.updateTimeline();
    }

    function drawCut() {
        if (!times.length) return;
        const cut = cutPlan();
        exportButton.disabled = preparing || exporting;
        showCutButton.disabled = preparing;
        const marked = node.properties.vkViggleStartMarked || Number(startWidget.value) > 0;
        drawTimeline();
        const quickFraction = (frame) => (frame - 1) / Math.max(1, times.length - 1) * 100;
        get(".quick-start").style.left = `calc(8px + (100% - 16px) * ${quickFraction(cut.first) / 100})`;
        get(".quick-end").style.left = `calc(8px + (100% - 16px) * ${quickFraction(cut.last) / 100})`;
        get(".quick-start").title = `Cut starts at loaded frame ${cut.first}`;
        get(".quick-end").title = `Cut ends at loaded frame ${cut.last}`;
        get(".quick-start").dataset.frame = cut.first;
        get(".quick-end").dataset.frame = cut.last;
        get(".quick-start").disabled = get(".quick-end").disabled = false;
        drawChunks(cut);
        get(".cut-summary").textContent = `Cut: ${cut.count} frames · ${cut.seconds.toFixed(3)} s`;
        get(".guide-back").disabled = get(".guide-forward").disabled = preparing;
        markEnd.disabled = preparing || cursorFrame < 5;
        reset.disabled = !marked && !Number(endWidget.value) && !Number(capWidget.value);

        chosen.options.min = cut.first;
        chosen.options.max = cut.last;
        const frame = Math.max(cut.first, Math.min(cut.last, Number(chosen.value) || cut.first));
        chosen.value = frame;
        drawPosition();
        updateOptions();
        root.querySelectorAll(".preview-modes button[data-mode]").forEach(button => button.disabled = preparing || !times.length);
    }

    function focusFrame(frame) {
        player.pause(); seek(frame);
        const scroll = get(".scroll");
        scroll.scrollTo({left:fraction(frame) * track.clientWidth - scroll.clientWidth / 2});
        slider.focus({preventScroll:true});
    }
    function drawChunks(cut) {
        const markers = get(".chunk-markers");
        markers.replaceChildren();
        const timeline = get(".chunk-timeline-markers");
        timeline.replaceChildren();
        const spans = loadedSpans();
        const frames = new Set();
        spans.forEach((span, index) => {
            if (index === 0) return;
            const frame = span.first + 1;
            if (frames.has(frame)) return;
            frames.add(frame);
            const marker = document.createElement("button");
            marker.type = "button"; marker.className = "quick-symbol chunk-symbol start";
            marker.title = `Chunk ${index + 1} start · loaded frame ${span.first + 1}`;
            marker.setAttribute("aria-label",marker.title);
            marker.dataset.frame = frame;
            marker.style.left = `calc(8px + (100% - 16px) * ${(frame - 1) / Math.max(1,times.length - 1)})`;
            marker.onclick = (event) => { event.stopPropagation(); focusFrame(frame); };
            markers.append(marker);
            const cursor = document.createElement("div");
            cursor.className = "marker chunk-timeline-marker";
            cursor.title = marker.title; cursor.dataset.frame = frame;
            cursor.style.left = `calc(${fraction(frame) * 100}% - 2px)`;
            timeline.append(cursor);
        });
        layoutQuickMarkers();
        guidesUI.render();
    }

    function layoutQuickMarkers() {
        const area = get(".quick-markers"), width = area.clientWidth;
        if (!width) return;
        const lanes = [];
        for (const marker of area.querySelectorAll("button")) {
            const markerWidth = marker.offsetWidth;
            const fraction = (Number(marker.dataset.frame || 1) - 1) / Math.max(1,times.length - 1);
            const left = Math.max(0,Math.min(width - markerWidth,8 + (width - 16) * fraction - markerWidth / 2));
            const right = left + markerWidth;
            let lane = lanes.findIndex((intervals) => intervals.every(([start,end]) => right + 4 <= start || left >= end + 4));
            if (lane < 0) { lane = lanes.length; lanes.push([]); }
            lanes[lane].push([left,right]);
            marker.style.left = `${left + markerWidth / 2}px`;
            marker.style.top = `${lane * 22}px`;
        }
        area.style.height = `${Math.max(1,lanes.length) * 22}px`;
    }

    function updateCut() {
        if (!sourceInfo) return;
        clearInspection();
        const referenceTime = selectionTime ?? (loadedStart + (times[Number(chosen.value) - 1] || 0));
        preparing = true;
        exportButton.disabled = true;
        showCutButton.disabled = true;
        updateOptions();
        node.graph?.setDirtyCanvas(true,true);
        guidesUI.render();
        player.pause();
        play.disabled = stop.disabled = slider.disabled = markStart.disabled = markEnd.disabled = true;

        root.querySelectorAll(".preview-modes button[data-mode]").forEach(button => button.disabled = true);
        setStatus("Preparing player preview… First preparation can take a while for long videos.", true);
        clearTimeout(cutTimer);
        cutController?.abort();
        const version = ++cutVersion;
        const settings = query();
        cutTimer = setTimeout(async () => {
            cutController = new AbortController();
            try {
                const response = await api.fetchApi(`/vk-viggle/video/cut?${settings}`, {signal:cutController.signal, cache:"no-store"});
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Cannot read cut.");
                if (version !== cutVersion) return;
                if (result.times.length < 5) {
                    if (!acceptedCut) throw new Error("Viggle needs at least 5 loaded frames. Extend the cut or increase the loaded FPS.");
                    startWidget.value = acceptedCut.start;
                    endWidget.value = acceptedCut.end;
                    capWidget.value = acceptedCut.cap;
                    rateWidget.value = acceptedCut.rate;
                    cutNotice = "Viggle needs at least 5 loaded frames. Previous cut restored.";
                    updateCut();
                    return;
                }
                times = result.times;
                seekTimes = result.seek_times || [];
                acceptedCut = Object.fromEntries(["start", "end", "cap", "rate"].map(key => [key, Number(settings.get(key))]));
                loadedStart = Number(settings.get("start"));
                duration = result.duration;
                if (!(node.properties.vkViggleHasReference ?? Number(chosen.value) > 1)) {
                    chosen.value = 1;
                } else if (selectionTime !== undefined || frameSpace.value === "source") {
                    chosen.value = nearestFrame(referenceTime - loadedStart);
                } else {
                    chosen.value = Math.max(1, Math.min(times.length, Number(chosen.value) || 1));
                }
                selectionTime = undefined;
                frameSpace.value = "loaded";
                slider.max = times.length;
                const playerURL = api.apiURL(`/vk-viggle/video/player?${new URLSearchParams({video:currentSource,preview_max:settings.get("preview_max")})}`);
                if (player.getAttribute("src") !== playerURL) player.src = playerURL;
                scheduleSeek(seekTimes[0] ?? loadedStart + (times[0] || 0));
                browserPlayback = true;
                cursorFrame = 1;
                play.disabled = stop.disabled = slider.disabled = markStart.disabled = false;
                get(".video-info").textContent = `${result.width} × ${result.height} · ${times.length} loaded frames · ${Number(rateWidget.value) || result.fps} FPS`;
                setStatus(cutNotice || "Video ready.");
                cutNotice = undefined;
                preparing = false;
                guidesUI.onVideoLoaded();
                drawCut();
                if (sheetKey !== thumbnailKey()) {
                    thumbnails(generation).catch(error => { if (error.name !== "AbortError") setStatus(error.message, false, true); });
                }
                node.graph?.setDirtyCanvas(true, true);
            } catch (error) {
                if (error.name !== "AbortError" && version === cutVersion) setStatus(error.message, false, true);
            }
        }, 200);
    }

    const query = (extra = {}) => new URLSearchParams({video:currentSource, loaded:"1",
        start:startWidget.value, end:endWidget.value, rate:rateWidget.value, cap:capWidget.value,
        longest:widget("longest_side").value, shortest:widget("shortest_side").value,
        resize_mode:widget("resize_mode").value, resolution:widget("resolution_config").value,
        preview_max:node.properties.vkVigglePreviewMax ?? 720, ...extra});
    const endpoint = (action, extra) => `/vk-viggle/video/${action}?${query(extra)}`;
    const timelineBounds = () => showOnlyCut ? [loadedStart, duration] : [0, sourceInfo?.duration || 1];
    const timelineFraction = (time) => {
        const [start, length] = timelineBounds();
        return Math.max(0, Math.min(1, (time - start) / (length || 1)));
    };
    const fraction = (frame) => timelineFraction(loadedStart + (times[frame - 1] || 0));
    const thumbnailKey = () => `${currentSource}:${node.properties.vkVigglePreviewMax ?? 720}:${showOnlyCut ? `${loadedStart}:${duration}` : "original"}`;
    const drawPosition = () => {
        if (!times.length) return;
        get(".select").disabled = preparing || !guidesUI.canSelectReference();
        if (inspectionFrame !== null) {
            const time = sourceInfo.times[inspectionFrame - 1], end = sourceInfo.times[inspectionFrame] ?? sourceInfo.duration;
            const rate = Number(rateWidget.value);
            const enoughFrames = (start,end) => rate ? (end - start) * rate >= 5 - 0.000001 :
                sourceInfo.times.filter(value=>value >= start - 0.000001 && value < end - 0.000001).length >= 5;
            const requestedEnd = Number(endWidget.value) > time ? Number(endWidget.value) : sourceInfo.duration;
            get(".position").textContent = `Source frame ${inspectionFrame} / ${sourceInfo.times.length} · ${time.toFixed(3)} s · outside cut`;
            get(".position-time").textContent = `${formatVideoTime(time)} / ${formatVideoTime(sourceInfo.duration)}`;
            get(".chunk-timing").textContent = "";
            get(".loaded-position").textContent = "Outside cut · use Mark Start or Mark End to include this position.";
            get(".playhead").style.left = `calc(${timelineFraction(time) * 100}% - 1px)`;
            markStart.disabled = preparing || !enoughFrames(time,requestedEnd);
            markEnd.disabled = preparing || !enoughFrames(Number(startWidget.value),end);

            get(".guide-back").disabled = get(".guide-forward").disabled = true;
            root.querySelectorAll(".guide-add,.guide-add-body,.guide-add-both,.guide-replace").forEach(button=>button.disabled = true);
            return;
        }
        get(".guide-back").disabled = get(".guide-forward").disabled = preparing;
        const frame = browserPlayback && !player.paused ? frameAtTime(times, player.currentTime - loadedStart) : cursorFrame;
        cursorFrame = frame;
        slider.value = frame;
        const cut = cutPlan();
        const spans = loadedSpans();
        const current = frame < cut.first || frame > cut.last || !spans.length ? -1 : frameAtTime(spanStarts, frame) - 1;
        const guides = JSON.parse(widget("guide_selection").value || "{}");
        const guideTimes = guides.video === currentSource ? guides.times || [] : [];
        const time = loadedStart + times[frame - 1];
        const distance = guideTimes.length ? guideTimes.reduce((nearest,guide)=>Math.min(nearest,Math.abs(time-guide)),Infinity).toFixed(2) : "—";
        get(".position").textContent = `Frame ${frame} / ${times.length} : Chunks ${current < 0 ? "—" : current + 1} / ${spans.length || "—"} - Distance from closest guide : ${distance} seconds`;
        get(".position").title = "Loaded-video frame and chunk / total chunks for five_frame_anchor continuation. In overlaps, the later chunk is shown. Distance includes all guides and chunk references in this video, in source-time seconds; — means none are selected.";
        get(".position-time").textContent = `${formatVideoTime(loadedStart + times[frame - 1])} / ${formatVideoTime(sourceInfo.duration)}`;
        const loadedFrame = frame;
        const span = spans[current];
        get(".loaded-position").textContent = current < 0 ? `Loaded frame: — / ${cut.count}` :
            `Loaded frame ${loadedFrame} / ${cut.count} · Chunk ${current + 1}: ${span.first + 1}–${span.last + 1} (loaded frames)`;
        const shared = spans.map((other,index) => index !== current && frame >= other.first + 1 && frame <= other.last + 1 ? index + 1 : null).filter(index => index !== null);
        get(".chunk-timing").textContent = span ?
            `Chunk ${current + 1}: ${formatVideoTime(loadedStart + times[span.first])}–${formatVideoTime(loadedStart + (times[span.last + 1] ?? duration))} (source time, end exclusive)` +
            (shared.length ? ` · Overlap with chunk ${shared.join(", ")}` : "") +
            (span.generatedLast > span.last ? ` · H3 padding: ${span.generatedLast - span.last} repeated tail frames (generation ends at frame ${span.generatedLast + 1})` : "") : "";
        get(".playhead").style.left = `calc(${fraction(frame) * 100}% - 1px)`;
        markStart.disabled = preparing || times.length - frame < 4;
        markEnd.disabled = preparing || frame < 5;

        if (!player.paused && player.currentTime >= loadedStart + duration - 0.000001) {
            player.pause();
            seek(cut.last);
        }
    };
    const animate = () => {
        drawPosition();
        if (!player.paused) animation = requestAnimationFrame(animate);
    };
    const seek = (frame) => {
        const wasInspecting = inspectionFrame !== null;
        clearInspection();
        cursorFrame = frame;
        const index = Math.max(0, Math.min(times.length - 1, frame - 1));
        scheduleSeek(seekTimes[index] ?? loadedStart + (times[index] || 0));
        drawPosition();
        if (wasInspecting) guidesUI.render(false);
    };
    function scheduleSeek(time) {
        pendingSeek = time;
        if (seekAnimation) return;
        seekAnimation = requestAnimationFrame(() => {
            seekAnimation = undefined;
            player.currentTime = pendingSeek;
        });
    }
    player.addEventListener("loadedmetadata", () => {
        if (pendingSeek !== undefined) player.currentTime = pendingSeek;
    });
    async function thumbnails(version) {
        const key = thumbnailKey();
        thumbnailsController?.abort();
        const thumbnailTimes = sourceInfo.times;
        let first = 1, last = thumbnailTimes.length;
        if (showOnlyCut) {
            first = frameAtTime(thumbnailTimes, loadedStart);
            if (thumbnailTimes[first - 1] < loadedStart - 0.000001) first = Math.min(first + 1, thumbnailTimes.length);
            last = frameAtTime(thumbnailTimes, loadedStart + duration);
            if (thumbnailTimes[last - 1] >= loadedStart + duration - 0.000001) last--;
            last = Math.max(first, last);
        }
        const count = Math.min(12, last - first + 1);
        const frames = [...new Set(Array.from({ length: count }, (_, i) =>
            frameAtTime(thumbnailTimes, thumbnailTimes[first - 1] + (thumbnailTimes[last - 1] - thumbnailTimes[first - 1]) * i / Math.max(1, count - 1))))];
        thumbnailsController = new AbortController();
        const response = await api.fetchApi(`/vk-viggle/video/thumbnails?${new URLSearchParams({video:currentSource,frames:frames.join(","),preview_max:node.properties.vkVigglePreviewMax ?? 720})}`, {signal:thumbnailsController.signal,cache:"no-store"});
        if (!response.ok) throw new Error("Cannot load source thumbnails.");
        const blob = await response.blob();
        if (version !== generation || key !== thumbnailKey()) return;
        sheetKey = key;
        track.querySelectorAll(".thumb").forEach(thumb => thumb.remove());
        if (sheetUrl) URL.revokeObjectURL(sheetUrl);
        sheetUrl = URL.createObjectURL(blob);
        track.style.width = `${frames.length * 100}px`;
        frames.forEach((frame, i) => {
            const thumb = document.createElement("div");
            thumb.className = "thumb";
            thumb.title = `Source frame ${frame}`;
            thumb.style.left = `${i * 100}px`;
            thumb.style.backgroundImage = `url("${sheetUrl}")`;
            thumb.style.backgroundSize = `${frames.length * 100}px 56px`;
            thumb.style.backgroundPosition = `${-i * 100}px 0`;
            track.prepend(thumb);
        });
    }
    async function load(resetSelection = false) {
        if (disposed) return;
        showOnlyCut = Boolean(node.properties.vkViggleShowOnlyCut);
        showCutButton.firstElementChild.textContent = showOnlyCut ? "Show original video" : "Show only cut";
        showCutButton.setAttribute("aria-pressed", String(showOnlyCut));
        clearInspection();
        const value = source.value;
        if (!value) return;
        const same = value === currentSource;
        if (same && sourceInfo) {
            resolutionUI.updateSummary();
            selectionTime = frameSpace.value === "source" ? sourceInfo.times[Math.max(0, Math.min(sourceInfo.times.length - 1, Number(chosen.value) - 1))] : loadedStart + (times[Number(chosen.value) - 1] || 0);
            updateCut();
            return;
        }
        infoController?.abort(); thumbnailsController?.abort();
        clearTimeout(cutTimer); cutController?.abort(); ++cutVersion;
        const version = ++generation;
        cancelAnimationFrame(seekAnimation); seekAnimation = undefined; pendingSeek = undefined;
        sheetKey = undefined;
        currentSource = value;
        if (resetSelection || !widget("resolution_config").value) resolutionUI.applyDefault();
        times = [];
        guidesUI.render();
        selectionTime = acceptedCut = cutNotice = undefined;
        preparing = true;
        exportButton.disabled = true;
        showCutButton.disabled = true;
        sourceInfo = undefined;
        resolutionUI.updateSummary();
        get(".chunk-markers").replaceChildren();
        get(".chunk-timeline-markers").replaceChildren();
        get(".video-info").textContent = "";
        get(".cut-summary").textContent = "Cut: — frames · — s";
        get(".position").textContent = "Frame 1 · Chunks: —";
        get(".position-time").textContent = "00:00:00.000 / —";
        get(".chunk-timing").textContent = "";
        get(".loaded-position").textContent = "Loaded frame: —";
        get(".cut-start").hidden = get(".cut-end").hidden = true;
        get(".excluded-start").hidden = get(".excluded-end").hidden = get(".requested-end").hidden = true;
        cursorFrame = 1;
        browserPlayback = true;
        player.pause();
        play.textContent = "Play";
        play.disabled = stop.disabled = slider.disabled = markStart.disabled = markEnd.disabled = reset.disabled = true;
        get(".guide-back").disabled = get(".guide-forward").disabled = true;
        get(".quick-start").disabled = get(".quick-end").disabled = true;
        track.querySelectorAll(".thumb").forEach((thumb) => thumb.remove());
        if (resetSelection) {
            chosen.value = 1;
            startWidget.value = endWidget.value = 0;
            node.properties.vkViggleStartMarked = false;
            node.properties.vkViggleHasReference = false;
        }
        player.removeAttribute("src");
        setStatus("Reading source frame positions…", true);
        infoController = new AbortController();
        try {
            const response = await api.fetchApi(endpoint("info"), { signal: infoController.signal, cache: "no-store" });
            const info = await response.json();
            if (!response.ok) throw new Error(info.error || "Cannot read video.");
            if (version !== generation) return;
            sourceInfo = info;
            const history = readHistory().filter(item => item.video !== value);
            history.unshift({video:value, loadedAt:Date.now()});
            localStorage.setItem(historyKey,JSON.stringify(history.slice(0,20)));
            if (info.saved_guides) widget("guide_selection").value = JSON.stringify(info.saved_guides);
            if (info.saved_guides?.defaults) widget("prompt_defaults").value = JSON.stringify(info.saved_guides.defaults);
            resolutionUI.updateSummary();
            if (info.saved_guides?.reference) {
                selectionTime = info.saved_guides.reference.time;
                widget("reference_settings").value = JSON.stringify(info.saved_guides.reference.settings);
                node.properties.vkViggleHasReference = true;
            } else if (frameSpace.value === "source") {
                selectionTime = info.times[Math.max(0, Math.min(info.times.length - 1, Number(chosen.value) - 1))];
            }
            updateCut();
        } catch (error) {
            if (error.name !== "AbortError" && version === generation) setStatus(error.message, false, true);
        }
    }
    play.onclick = async () => {
        if (player.paused) {
            const cut = cutPlan();
            if (inspectionFrame !== null || cursorFrame < cut.first || cursorFrame >= cut.last) seek(cut.first);
            try { await player.play(); }
            catch {
                browserPlayback = false;
                setStatus("Browser cannot play this format; use the timeline to select a frame.", false, true);
            }
        } else {
            cursorFrame = frameAtTime(times, player.currentTime - loadedStart);
            player.pause();
        }
    };
    stop.onclick = () => { player.pause(); seek(cutPlan().first); };
    markStart.onclick = () => {
        if (markStart.disabled) return;
        player.pause();
        selectionTime = loadedStart + (times[Number(chosen.value) - 1] || 0);
        startWidget.value = inspectionFrame !== null ? sourceInfo.times[inspectionFrame - 1] : loadedStart + times[cursorFrame - 1];
        node.properties.vkViggleStartMarked = true;
        if (Number(endWidget.value) && Number(endWidget.value) <= Number(startWidget.value)) endWidget.value = 0;
        updateCut();
    };
    markEnd.onclick = () => {
        if (markEnd.disabled) return;
        player.pause();
        node.properties.vkViggleStartMarked = true;
        selectionTime = loadedStart + (times[Number(chosen.value) - 1] || 0);
        endWidget.value = inspectionFrame !== null ? sourceInfo.times[inspectionFrame] ?? sourceInfo.duration : loadedStart + (times[cursorFrame] ?? duration);
        updateCut();
    };
    reset.onclick = () => {
        player.pause();
        selectionTime = loadedStart + (times[Number(chosen.value) - 1] || 0);
        startWidget.value = endWidget.value = capWidget.value = 0;
        node.properties.vkViggleStartMarked = false;
        updateCut();
    };
    exportButton.onclick = async () => {
        if (exportButton.disabled) return;
        const url = endpoint("export");
        const version = generation;
        const filename = `${currentSource.split(/[\\/]/).pop().replace(/\.[^.]+$/, "")}-cut.mp4`;
        exporting = true; exportButton.disabled = true;
        let writable;
        try {
            const handle = window.showSaveFilePicker ? await window.showSaveFilePicker({suggestedName:filename,
                types:[{description:"MP4 video",accept:{"video/mp4":[".mp4"]}}]}) : null;
            if (version !== generation) return;
            exportController = new AbortController();
            exportButton.textContent = "Exporting…";
            setStatus(`Exporting ${filename} at processing resolution and FPS…`, true);
            const response = await api.fetchApi(url, {method:"POST",signal:exportController.signal});
            if (!response.ok) throw new Error((await response.json()).error || "Cut export failed.");
            if (handle) {
                writable = await handle.createWritable();
                await response.body.pipeTo(writable);
                writable = undefined;
                setStatus(`Cut saved: ${handle.name}`);
            } else {
                if (exportUrl) URL.revokeObjectURL(exportUrl);
                exportUrl = URL.createObjectURL(await response.blob());
                const link = exportDialog.querySelector("a");
                link.href = exportUrl; link.download = filename;
                exportDialog.showModal();
                setStatus("Cut ready. Choose Save link as… in the export dialog to select its destination.");
            }
        } catch (error) {
            if (writable) await writable.abort().catch(() => {});
            if (error.name !== "AbortError") setStatus(error.message, false, true);
        } finally {
            exporting = false; exportButton.textContent = "Export cut";
            exportButton.disabled = preparing || !times.length;
        }
    };
    showCutButton.onclick = () => {
        if (showCutButton.disabled) return;
        showOnlyCut = !showOnlyCut;
        node.properties.vkViggleShowOnlyCut = showOnlyCut;
        showCutButton.firstElementChild.textContent = showOnlyCut ? "Show original video" : "Show only cut";
        showCutButton.setAttribute("aria-pressed", String(showOnlyCut));
        if (showOnlyCut && inspectionFrame !== null) seek(1);
        get(".scroll").scrollLeft = 0;
        drawTimeline();
        drawPosition();
        thumbnails(generation).catch(error => { if (error.name !== "AbortError") setStatus(error.message, false, true); });
        node.graph?.setDirtyCanvas(true,true);
    };
    get(".timeline-prev").onclick = () => get(".scroll").scrollBy({ left: -300, behavior: "smooth" });
    get(".timeline-next").onclick = () => get(".scroll").scrollBy({ left: 300, behavior: "smooth" });
    for (const [selector, boundary] of [[".quick-start", "first"], [".quick-end", "last"]]) {
        get(selector).onclick = (event) => {
            event.stopPropagation();
            focusFrame(cutPlan()[boundary]);
        };
    }
    root.querySelectorAll(".preview-modes button[data-mode]").forEach((button) => {
        button.onclick = () => {
            focusFrame(button.dataset.mode === "first" ? 1 : times.length);
        };
    });
    slider.oninput = () => { player.pause(); seek(Number(slider.value)); };
    track.onclick = (event) => {
        if (!times.length || preparing) return;
        const rect = track.getBoundingClientRect();
        player.pause();
        const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const [start, length] = timelineBounds();
        const sourceTime = start + position * length;
        if (!showOnlyCut && (sourceTime < loadedStart || sourceTime >= loadedStart + duration)) {
            inspectSource(frameAtTime(sourceInfo.times,sourceTime));
            return;
        }
        const time = sourceTime - loadedStart;
        const frame = frameAtTime(times, time);
        seek(frame);
        guidesUI.inspectFrame(frame);
    };
    player.addEventListener("play", () => { play.textContent = "Pause"; cancelAnimationFrame(animation); animate(); });
    player.addEventListener("pause", () => { play.textContent = "Play"; cancelAnimationFrame(animation); drawPosition(); });
    player.addEventListener("timeupdate", drawPosition);
    player.addEventListener("seeked", drawPosition);
    player.addEventListener("error", () => {
        browserPlayback = false;
        setStatus("Browser playback unavailable for this codec. The frame timeline remains usable.", false, true);
    });

    const historyKey = "vk-viggle-video-history";
    function readHistory() {
        return JSON.parse(localStorage.getItem(historyKey) || "[]").sort((a,b) => b.loadedAt - a.loadedAt).slice(0,20);
    }
    const historyDialog = document.createElement("dialog");
    historyDialog.className = "vk-viggle-video-history";
    historyDialog.setAttribute("aria-label","Previous videos");
    document.body.append(historyDialog);
    get(".previous-video").onclick = () => {
        historyDialog.innerHTML = '<header><h2>Previous videos</h2><form method="dialog"><button>Close</button></form></header><div class="history-list"></div>';
        const list = historyDialog.querySelector(".history-list"), history = readHistory();
        if (!history.length) list.textContent = "No previously loaded videos.";
        for (const item of history) {
            const button = document.createElement("button"), name = document.createElement("strong"), date = document.createElement("small");
            name.textContent = item.video; date.textContent = new Date(item.loadedAt).toLocaleString();
            const preview = document.createElement("span"), image = document.createElement("img"), unavailable = document.createElement("span"), description = document.createElement("span");
            preview.className = "history-preview"; description.className = "history-description";
            image.alt = `First frame of ${item.video}`;
            image.loading = "lazy"; image.decoding = "async"; image.width = 160; image.height = 90;
            unavailable.textContent = "Preview unavailable"; unavailable.hidden = true;
            image.onerror = () => { image.hidden = true; unavailable.hidden = false; };
            image.src = api.apiURL(`/vk-viggle/video/thumbnails?${new URLSearchParams({video:item.video,frames:"1"})}`);
            preview.append(image,unavailable); description.append(name,date); button.append(preview,description);
            button.onclick = () => {
                source.value = item.video;
                historyDialog.close(); load(true); updateOptions(); node.graph?.setDirtyCanvas(true,true);
            };
            list.append(button);
        }
        historyDialog.showModal();
    };
    const uploadInput = document.createElement("input");
    uploadInput.type = "file";
    uploadInput.accept = ".mp4,.webm,.mkv,.gif,.mov";
    get(".upload").onclick = () => uploadInput.click();
    async function upload(file) {
        if (!/\.(mp4|webm|mkv|gif|mov)$/i.test(file.name)) {
            setStatus("Choose MP4, WebM, MKV, GIF or MOV.", false, true);
            return;
        }
        const body = new FormData();
        body.append("image", file); body.append("type", "input");
        setStatus(`Uploading ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MiB)…`, true);
        console.info(`[VK Video] Upload started: ${file.name} (${file.size} bytes)`);
        try {
            const response = await api.fetchApi("/upload/image", { method: "POST", body });
            if (response.status === 413) throw new Error("Upload rejected (HTTP 413): video exceeds the server upload limit. Increase ComfyUI --max-upload-size (default 100 MiB), restart, then retry; or copy the video into ComfyUI/input and refresh the video list. Preview preparation has not started.");
            if (!response.ok) throw new Error(`Upload failed (HTTP ${response.status}).`);
            const result = await response.json();
            console.info(`[VK Video] Upload completed: ${file.name}`);
            const value = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
            if (!source.options.values.includes(value)) source.options.values.push(value);
            source.value = value;
            currentSource = undefined;
            await load(true);
            node.graph?.setDirtyCanvas(true, true);
        } catch (error) { setStatus(error.message, false, true); console.warn(`[VK Video] ${file.name}: ${error.message}`); }
        uploadInput.value = "";
    }
    uploadInput.onchange = () => { if (uploadInput.files[0]) upload(uploadInput.files[0]); };
    root.ondragover = (event) => { event.preventDefault(); event.stopPropagation(); };
    root.ondrop = (event) => {
        event.preventDefault(); event.stopPropagation();
        if (event.dataTransfer.files[0]) upload(event.dataTransfer.files[0]);
    };
    for (const [name,delta] of [["guide-back",-1],["guide-forward",1]]) get(`.${name}`).onclick = () => focusFrame(Math.max(1,Math.min(times.length,cursorFrame+delta)));
    const sourceCallback = source.callback;
    source.callback = function () {
        sourceCallback?.apply(this, arguments);
        load(source.value !== currentSource);
    };
    const chosenCallback = chosen.callback;
    chosen.callback = function () {
        chosenCallback?.apply(this, arguments);
        frameSpace.value = "loaded";
        node.properties.vkViggleHasReference = true;
        drawCut();
    };
    const chunkCallback = chunkWidget.callback;
    chunkWidget.callback = function () {
        chunkCallback?.apply(this, arguments);
        if (times.length) drawChunks(cutPlan());
        drawPosition();
    };
    for (const field of [startWidget, endWidget, capWidget, rateWidget, widget("longest_side"), widget("shortest_side"), widget("resize_mode")]) {
        const callback = field.callback;
        field.callback = function () {
            callback?.apply(this, arguments);
            selectionTime = loadedStart + (times[Number(chosen.value) - 1] || 0);
            if (field === capWidget && Number(capWidget.value) > 0 && Number(capWidget.value) < 5) capWidget.value = 5;
            if (field === startWidget) {
                node.properties.vkViggleStartMarked = true;
                if (Number(endWidget.value) && Number(endWidget.value) <= Number(startWidget.value)) endWidget.value = 0;
            }
            if (field === endWidget && Number(endWidget.value) && Number(endWidget.value) <= Number(startWidget.value)) {
                endWidget.value = loadedStart + (times[cutPlan().first] ?? duration);
            }
            updateCut();
        };
    }
    const optionFields = new Map();
    const previewOption = document.createElement("label");
    previewOption.className = "preview-option";
    previewOption.textContent = "Player preview max resolution";
    previewOption.title = "Maximum short edge for the cached player preview. 720p is a useful starting point. Preserves proportions without enlarging the source. Guides and image outputs keep their processing resolution. Changing this prepares another preview of the entire source.";
    const previewMax = document.createElement("select");
    previewMax.setAttribute("aria-label", "Player preview max resolution");
    for (const [value,label] of [[480,"480p"],[720,"720p"],[1080,"1080p"],[0,"Original"]]) {
        const option = document.createElement("option"); option.value = value; option.textContent = label; previewMax.append(option);
    }
    previewMax.onchange = () => {
        node.properties.vkVigglePreviewMax = Number(previewMax.value);
        updateCut();
        node.graph?.setDirtyCanvas(true,true);
    };
    previewOption.append(previewMax); get(".option-fields").append(previewOption);
    const labels = {force_rate:"FPS (0 = source)", frame_load_cap:"Frame limit (0 = all)",
        start_time:"Start · seconds", end_time:"End · s (0 = end)",
        chunk_frames:"Chunk length · frames"};
    for (const [name, label] of Object.entries(labels)) {
        const field = widget(name);
        field.hidden = true;
        const wrapper = document.createElement("label");
        wrapper.textContent = label;
        wrapper.title = field.tooltip || field.options?.tooltip || label;
        const input = document.createElement("input");
        input.dataset.option = name;
        input.setAttribute("aria-label", label);
        input.type = "number";
        input.min = field.options?.min ?? (["selected_frame_number","chunk_frames"].includes(name) ? 1 : 0);
        input.max = field.options?.max ?? 2147483647;
        input.step = ["start_time","end_time","force_rate"].includes(name) ? "0.001" : "1";
        input.onchange = () => {
            if (!input.checkValidity()) { input.reportValidity(); input.value = field.value; return; }
            const value = Number(input.value);
            if (field.value === value) return;
            field.value = value;
            field.callback?.(field.value);
            updateOptions();
            node.graph?.setDirtyCanvas(true,true);
        };
        if (name === "chunk_frames") input.oninput = () => {
            if (input.value !== "" && input.checkValidity()) input.onchange();
        };
        wrapper.append(input); get(".option-fields").append(wrapper); optionFields.set(field,input);
        const callback = field.callback;
        field.callback = function () { const result = callback?.apply(this,arguments); updateOptions(); return result; };
    }
    function updateOptions() {
        previewMax.value = node.properties.vkVigglePreviewMax ?? 720;
        for (const [field,input] of optionFields) {
            input.value = field.value;
            input.disabled = Boolean(node.inputs?.some(input => input.name === field.name && input.link != null));
        }
    }
    const panel = node.addDOMWidget("vk_viggle_video_player", "vk_viggle_video_player", root, {
        hideOnZoom: false, getValue: () => undefined, setValue: () => {}, getMinHeight: () => 1000,
        onDraw(widget) {
            // Use node coordinates so a DOM host reflow cannot collapse the player layout.
            const width = `${node.size[0] - 2 * widget.margin}px`;
            if (root.style.width !== width) root.style.width = width;
        },
    });
    panel.serialize = false;
    panel.serializeValue = () => undefined;
    const resolutionUI = buildResolutionUI(node,root,{info:() => sourceInfo, frame:displayedFrame, updateOptions,
        endpoint, rate:() => rateWidget.value, apply:() => { selectionTime = loadedStart + (times[Number(chosen.value) - 1] || 0); updateCut(); }});
    const guidesUI = buildChunkGuidesUI(node,root,{
        spans:loadedSpans, times:() => times,
        start:() => loadedStart,
        duration:() => duration, video:() => currentSource,
        ready:() => !preparing && times.length > 0, frame:() => inspectionFrame === null ? cursorFrame : 0,
        seek:focusFrame, fraction, endpoint, guidesChanged:drawPosition, layoutMarkers:layoutQuickMarkers, fetch:(url,options) => api.fetchApi(url,options),
    });
    viewer.querySelector(".upload-row").after(status);
    const markerResize = new ResizeObserver(layoutQuickMarkers);
    markerResize.observe(get(".quick-markers"));
    updateOptions();
    node.setSize([Math.max(1200, node.size[0]), Math.max(1450, node.computeSize()[1])]);
    node._vkVigglePlayer = {
        load,
        updateOptions,
        updateGuideAngles: () => guidesUI.render(),
        restoreGuideSettings: () => guidesUI.restoreAutoSettings(),
        dispose() {
            disposed = true;
            clearInterval(statusTimer);
            exportController?.abort();
            exportDialog.close(); exportDialog.remove();
            if (exportUrl) URL.revokeObjectURL(exportUrl);
            ++generation;
            infoController?.abort(); thumbnailsController?.abort();
            clearTimeout(cutTimer); cutController?.abort(); ++cutVersion;
            cancelAnimationFrame(animation);
            cancelAnimationFrame(seekAnimation);
            player.pause(); player.removeAttribute("src");
            historyDialog.close(); historyDialog.remove();
            resolutionUI.dispose();
            guidesUI.dispose();
            markerResize.disconnect();
            if (sheetUrl) URL.revokeObjectURL(sheetUrl);
            root.remove();
        },
    };
    requestAnimationFrame(() => load());
}

app.registerExtension({
    name: "VK.ViggleVideoLoader",
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "VKViggleVideoLoader") return;
        styles();
        const created = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = created?.apply(this, arguments);
            buildPlayer(this);
            return result;
        };
        const restore = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            const obsolete = (info.outputs || []).flatMap((output,index) =>
                ["mask","video_info","last_frame"].includes(output.name) ||
                (info.outputs.length === 7 && index === 5 && output.name === "first_frame") ? [index] : []);
            const result = restore.apply(this, arguments);
            for (const index of obsolete.reverse()) this.removeOutput(index);
            const outputs = [["IMAGE","IMAGE"],["audio","AUDIO"],["Ref Frame","IMAGE"],["first_frame","IMAGE"],
                ["chunk_frames","INT"],["guide_selection","VIGGLE_GUIDE_SELECTION"],
                ["ref_head_image","IMAGE"],["ref_body_image","IMAGE"],["ref_enable_head_swap","BOOLEAN"],
                ["ref_enable_body_swap","BOOLEAN"],["ref_head_additional_prompt","STRING"],["ref_body_additional_prompt","STRING"]];
            for (const [index,[name,type]] of outputs.entries()) {
                if (!this.outputs[index]) this.addOutput(name,type);
                Object.assign(this.outputs[index],{name,type});
            }
            if (this.outputs[2].label) this.outputs[2].label = "Ref Frame";
            return result;
        };
        const configure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = configure?.apply(this, arguments);
            if (!this.properties.vkViggleStudioLayout) {
                this.setSize([Math.max(1200,this.size[0]),Math.max(1450,this.computeSize()[1])]);
                this.properties.vkViggleStudioLayout = true;
            }
            this._vkVigglePlayer?.updateOptions();
            this._vkVigglePlayer?.restoreGuideSettings();
            requestAnimationFrame(() => this._vkVigglePlayer?.load());
            return result;
        };
        const connections = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function () {
            const result = connections?.apply(this, arguments);
            this._vkVigglePlayer?.updateGuideAngles();
            return result;
        };
        const removed = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._vkVigglePlayer?.dispose();
            return removed?.apply(this, arguments);
        };
    },
});
