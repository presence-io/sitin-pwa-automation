export const CSS = `
:root{
  --ab-bg:#ffffff;--ab-bg-soft:#f6f8fa;--ab-bg-sunken:#eef1f4;
  --ab-border:#d0d7de;--ab-border-soft:#e6e9ee;
  --ab-text:#1f2328;--ab-text-muted:#656d76;--ab-text-subtle:#8c959f;
  --ab-accent:#0969da;--ab-accent-hover:#0860c9;
  --ab-green:#1a7f37;--ab-amber:#9a6700;--ab-orange:#bc4c00;--ab-red:#cf222e;
  --ab-shadow:0 8px 28px rgba(31,35,40,.16);
}
#autobot-fab{position:fixed;bottom:20px;right:20px;width:48px;height:48px;border-radius:50%;background:var(--ab-accent);color:#fff;border:none;cursor:grab;z-index:999999;box-shadow:0 4px 14px rgba(9,105,218,.32);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;touch-action:none;user-select:none;transition:background .15s,box-shadow .15s}
#autobot-fab:hover{background:var(--ab-accent-hover)}
#autobot-fab:active{cursor:grabbing}
#autobot-panel{position:fixed;bottom:78px;right:20px;width:344px;max-height:82vh;overflow-y:auto;background:var(--ab-bg);color:var(--ab-text);border:1px solid var(--ab-border);border-radius:12px;box-shadow:var(--ab-shadow);z-index:999998;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;transform:scale(.96);opacity:0;pointer-events:none;transform-origin:bottom right;transition:transform .2s ease,opacity .2s ease}
#autobot-panel.open{transform:scale(1);opacity:1;pointer-events:auto}
#autobot-panel::-webkit-scrollbar{width:8px}
#autobot-panel::-webkit-scrollbar-thumb{background:#d0d7de;border-radius:4px}
#autobot-panel .hdr{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:var(--ab-bg);border-bottom:1px solid var(--ab-border-soft);border-radius:12px 12px 0 0;z-index:2}
#autobot-panel .hdr h3{margin:0;font-size:13px;font-weight:650;color:var(--ab-text);letter-spacing:.2px;display:flex;align-items:center;gap:6px}
#autobot-panel .hdr h3::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ab-green)}
#autobot-panel .hdr .cb{background:none;border:none;color:var(--ab-text-subtle);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:5px}
#autobot-panel .hdr .cb:hover{background:var(--ab-bg-sunken);color:var(--ab-text)}
#autobot-panel .body{padding:10px 14px 14px}
#autobot-panel .info{padding:7px 10px;background:var(--ab-bg-soft);border:1px solid var(--ab-border-soft);border-radius:7px;margin-bottom:10px;font-size:11px;color:var(--ab-text-muted);line-height:1.5}
#autobot-panel .info b{color:var(--ab-accent);font-weight:600}
#autobot-panel .cfg label{display:block;margin-bottom:3px;font-size:10px;color:var(--ab-text-muted);font-weight:500}
#autobot-panel .cfg input,#autobot-panel select{width:100%;padding:6px 8px;background:var(--ab-bg);border:1px solid var(--ab-border);border-radius:6px;color:var(--ab-text);font-size:11px;box-sizing:border-box;margin-bottom:7px;transition:border-color .15s,box-shadow .15s}
#autobot-panel .cfg input:focus,#autobot-panel select:focus{outline:none;border-color:var(--ab-accent);box-shadow:0 0 0 3px rgba(9,105,218,.12)}
#autobot-panel .grp{margin-bottom:4px}
#autobot-panel .grp-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 2px;cursor:pointer;border-bottom:1px solid var(--ab-border-soft);user-select:none}
#autobot-panel .grp-hdr:hover span:first-child{color:var(--ab-accent)}
#autobot-panel .grp-hdr span{font-size:12px;font-weight:600;color:var(--ab-text)}
#autobot-panel .grp-hdr .arr{color:var(--ab-text-subtle);font-size:9px;transition:transform .2s}
#autobot-panel .grp-hdr .arr.open{transform:rotate(90deg)}
#autobot-panel .grp-body{overflow:hidden;transition:max-height .25s ease;max-height:0}
#autobot-panel .grp-body.open{max-height:640px;overflow-y:auto}
#autobot-panel .grp-body .inner{padding:8px 2px 10px}
#autobot-panel .row{display:flex;align-items:center;gap:6px;margin-bottom:6px}
#autobot-panel .row button{flex-shrink:0;padding:6px 10px;background:var(--ab-bg-soft);color:var(--ab-text);border:1px solid var(--ab-border);border-radius:6px;cursor:pointer;font-size:11px;font-weight:550;white-space:nowrap;transition:background .15s,border-color .15s}
#autobot-panel .row button:hover{background:var(--ab-bg-sunken);border-color:#bcc4cd}
#autobot-panel .row button:active{background:#e3e7ec}
#autobot-panel .row button:disabled{opacity:.45;cursor:not-allowed}
#autobot-panel .row button.wide{flex:1}
#autobot-panel .row button.warn{color:var(--ab-orange);border-color:#f3c6a8}
#autobot-panel .row button.warn:hover{background:#fff3ec}
#autobot-panel .row button.green{color:var(--ab-green);border-color:#aedcb8}
#autobot-panel .row button.green:hover{background:#eaf6ee}
#autobot-panel .row button.accent{background:var(--ab-accent);color:#fff;border:1px solid var(--ab-accent);padding:9px;font-size:12px;font-weight:650;border-radius:7px;width:100%}
#autobot-panel .row button.accent:hover{background:var(--ab-accent-hover);border-color:var(--ab-accent-hover)}
#autobot-panel .st{flex:1;font-size:10px;color:var(--ab-text-subtle);word-break:break-all}
#autobot-panel .st.running{color:var(--ab-amber)}
#autobot-panel .st.done{color:var(--ab-green)}
#autobot-panel .st.error{color:var(--ab-red)}
#autobot-panel .st.warning{color:var(--ab-orange)}
#autobot-panel .rec-steps{max-height:120px;overflow-y:auto;font-size:10px;color:var(--ab-text-muted);background:var(--ab-bg-soft);border:1px solid var(--ab-border-soft);border-radius:6px;padding:6px 8px;margin-top:4px}
#autobot-panel .rec-steps .step{padding:2px 0;border-bottom:1px solid var(--ab-border-soft)}
#autobot-panel .rec-steps .step:last-child{border-bottom:none}
#autobot-panel .saved-item{display:flex;align-items:center;gap:5px;padding:5px 0;border-bottom:1px solid var(--ab-border-soft)}
#autobot-panel .saved-item .name{flex:1;font-size:11px;color:var(--ab-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#autobot-panel .saved-item button{padding:3px 7px;font-size:9px}
#autobot-minibar{position:fixed;top:0;left:0;right:0;height:34px;background:rgba(255,255,255,.94);color:var(--ab-text);display:flex;align-items:center;justify-content:center;gap:8px;z-index:999997;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:12px;font-weight:600;backdrop-filter:blur(8px);border-bottom:1px solid var(--ab-border);box-shadow:0 1px 6px rgba(31,35,40,.08);transform:translateY(-100%);transition:transform .22s;padding:0 12px}
#autobot-minibar.show{transform:translateY(0)}
#autobot-minibar .dot{width:8px;height:8px;border-radius:50%;background:var(--ab-red);animation:minibar-pulse 1s infinite}
#autobot-minibar.playing .dot{background:var(--ab-accent);animation:none}
#autobot-minibar .label{flex:1;text-align:center;color:var(--ab-text-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#autobot-minibar button{padding:4px 11px;border-radius:6px;border:none;font-size:10px;font-weight:650;cursor:pointer;color:#fff}
#autobot-minibar .btn-stop{background:var(--ab-red)}
#autobot-minibar .btn-pause{background:var(--ab-orange)}
#autobot-minibar .btn-resume{background:var(--ab-green)}
@keyframes minibar-pulse{0%,100%{opacity:1}50%{opacity:.3}}
`;
