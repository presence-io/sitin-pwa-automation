export const CSS = `
#autobot-fab{position:fixed;bottom:20px;right:20px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#00bcd4,#0f3460);color:#fff;border:none;cursor:grab;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;touch-action:none;user-select:none}
#autobot-fab:active{cursor:grabbing}
#autobot-panel{position:fixed;bottom:78px;right:20px;width:340px;max-height:82vh;overflow-y:auto;background:#1a1a2e;color:#eee;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.45);z-index:999998;font-family:-apple-system,sans-serif;font-size:12px;transform:scale(.9);opacity:0;pointer-events:none;transform-origin:bottom right;transition:transform .25s,opacity .25s}
#autobot-panel.open{transform:scale(1);opacity:1;pointer-events:auto}
#autobot-panel .hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#16213e;border-radius:12px 12px 0 0}
#autobot-panel .hdr h3{margin:0;font-size:13px;font-weight:700;color:#00bcd4}
#autobot-panel .hdr .cb{background:none;border:none;color:#888;cursor:pointer;font-size:16px}
#autobot-panel .body{padding:8px 12px}
#autobot-panel .info{padding:5px 7px;background:#0f3460;border-radius:6px;margin-bottom:8px;font-size:11px;color:#aaa}
#autobot-panel .info b{color:#00bcd4}
#autobot-panel .cfg label{display:block;margin-bottom:3px;font-size:10px;color:#aaa}
#autobot-panel .cfg input{width:100%;padding:5px 7px;background:#0f3460;border:1px solid #444;border-radius:5px;color:#eee;font-size:11px;box-sizing:border-box;margin-bottom:5px}
#autobot-panel .cfg input:focus{outline:none;border-color:#00bcd4}
#autobot-panel .grp{margin-bottom:6px}
#autobot-panel .grp-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 0;cursor:pointer;border-bottom:1px solid #333;user-select:none}
#autobot-panel .grp-hdr span{font-size:12px;font-weight:600;color:#00bcd4}
#autobot-panel .grp-hdr .arr{color:#666;font-size:10px;transition:transform .2s}
#autobot-panel .grp-hdr .arr.open{transform:rotate(90deg)}
#autobot-panel .grp-body{overflow:hidden;transition:max-height .3s;max-height:0}
#autobot-panel .grp-body.open{max-height:600px}
#autobot-panel .grp-body .inner{padding:6px 0}
#autobot-panel .row{display:flex;align-items:center;gap:6px;margin-bottom:4px}
#autobot-panel .row button{flex-shrink:0;padding:5px 8px;background:#0f3460;color:#eee;border:1px solid #00bcd4;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap}
#autobot-panel .row button:hover{background:#1a5276}
#autobot-panel .row button:disabled{opacity:.4;cursor:not-allowed}
#autobot-panel .row button.wide{flex:1}
#autobot-panel .row button.warn{border-color:#ff9800}
#autobot-panel .row button.green{border-color:#4caf50}
#autobot-panel .row button.accent{background:linear-gradient(135deg,#00bcd4,#0f3460);border:none;padding:8px;font-size:12px;font-weight:700;border-radius:7px;width:100%}
#autobot-panel .st{flex:1;font-size:10px;color:#888;word-break:break-all}
#autobot-panel .st.running{color:#ffeb3b}
#autobot-panel .st.done{color:#4caf50}
#autobot-panel .st.error{color:#f44336}
#autobot-panel .st.warning{color:#ff9800}
#autobot-panel .rec-steps{max-height:120px;overflow-y:auto;font-size:10px;color:#aaa;background:#0f3460;border-radius:4px;padding:4px 6px;margin-top:4px}
#autobot-panel .rec-steps .step{padding:1px 0;border-bottom:1px solid #1a1a2e}
#autobot-panel .rec-steps .step:last-child{border-bottom:none}
#autobot-panel .saved-item{display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid #333}
#autobot-panel .saved-item .name{flex:1;font-size:11px;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#autobot-panel .saved-item button{padding:2px 6px;font-size:9px}
#autobot-minibar{position:fixed;top:0;left:0;right:0;height:32px;background:rgba(26,26,46,.92);color:#eee;display:flex;align-items:center;justify-content:center;gap:8px;z-index:999997;font-family:-apple-system,sans-serif;font-size:12px;font-weight:600;backdrop-filter:blur(6px);box-shadow:0 2px 8px rgba(0,0,0,.3);transform:translateY(-100%);transition:transform .25s;padding:0 12px}
#autobot-minibar.show{transform:translateY(0)}
#autobot-minibar .dot{width:8px;height:8px;border-radius:50%;background:#f44336;animation:minibar-pulse 1s infinite}
#autobot-minibar.playing .dot{background:#00bcd4;animation:none}
#autobot-minibar .label{flex:1;text-align:center;color:#ccc;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#autobot-minibar button{padding:4px 10px;border-radius:4px;border:none;font-size:10px;font-weight:700;cursor:pointer;color:#fff}
#autobot-minibar .btn-stop{background:#f44336}
#autobot-minibar .btn-pause{background:#ff9800}
#autobot-minibar .btn-resume{background:#4caf50}
@keyframes minibar-pulse{0%,100%{opacity:1}50%{opacity:.3}}
`;
