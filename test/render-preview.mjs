import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const htmlContent = `<!DOCTYPE html>
<html lang="zh-CN" style="color-scheme: dark; background: #0f1117;">
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 40px;
  background: #0f1117;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #f3f4f6;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 60px;
}

@keyframes dshqb-pulse{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.4);opacity:1}}
.dshqb_root{display:flex;align-items:center;justify-content:center;color:#9ca3af;white-space:nowrap;font-size:12px;line-height:20px;padding:12px 24px;background:#181920;border:1px solid rgba(255,255,255,0.08);border-radius:8px;}
.dshqb_sep{display:inline-flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.2);margin:0 10px;user-select:none}
.dshqb_trigger{position:relative;display:inline-flex;align-items:center;cursor:default}
.dshqb_amount{color:#d1d5db;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center}
.dshqb_dot{display:block;width:7px;height:7px;border-radius:50%;margin-right:6px;flex-shrink:0;}
.dshqb_dot_btn{cursor:pointer;border:none;padding:0;background:transparent;outline:none;display:inline-flex;align-items:center;justify-content:center;line-height:1}
.dshqb_dot_success{background-color:#10b981;box-shadow:0 0 0 2px rgba(16,185,129,0.2)}
.dshqb_pricing_wrap{position:relative;display:inline-flex;align-items:center}
.dshqb_pricing{color:#9ca3af;display:inline-flex;align-items:center;justify-content:center;padding:2px;border-radius:999px;text-decoration:none;line-height:1}
.dshqb_pricing svg{display:block}

.dshqb_popover{
  position:relative;
  z-index:9999;
  min-width:480px;
  background:#1e1e24;
  border:1px solid rgba(255,255,255,0.1);
  border-radius:10px;
  box-shadow:0 16px 36px rgba(0,0,0,0.5),0 2px 6px rgba(0,0,0,0.25);
  padding:16px 18px;
  display:flex;
  flex-direction:row;
  gap:18px;
  box-sizing:border-box;
  color:#f3f4f6;
  font-size:12px;
  line-height:1.5;
  backdrop-filter:blur(16px);
}
.dshqb_col{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.dshqb_vsep{width:1px;background:rgba(255,255,255,0.1);align-self:stretch;margin:0 2px}
.dshqb_card_header{display:flex;align-items:center;justify-content:space-between;font-weight:600;font-size:12px;color:#9ca3af}
.dshqb_card_badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;line-height:14px}
.dshqb_card_badge_success{background:rgba(16,185,129,0.15);color:#10b981}
.dshqb_card_badge_info{background:rgba(59,130,246,0.15);color:#60a5fa}
.dshqb_card_row{display:flex;align-items:baseline;justify-content:space-between;font-size:12px}
.dshqb_card_val_main{font-size:16px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums}
.dshqb_card_sub{font-size:11px;color:#9ca3af;display:flex;gap:8px}
.dshqb_card_models{margin:4px 0 0;padding:0;list-style:none;font-size:11px;color:#9ca3af;display:flex;flex-direction:column;gap:2px}
.dshqb_card_models li{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}
.dshqb_card_hint{font-size:10.5px;color:#6b7280;margin-top:auto;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:3px}
.dshqb_card_tokens{display:flex;flex-direction:column;gap:2px;font-size:10.5px;color:#9ca3af;line-height:1.35}
.dshqb_card_hit{font-size:10px;color:#6b7280;opacity:0.9}

.dshqb_pricing_popover{
  position:relative;
  z-index:9999;
  min-width:340px;
  background:#1e1e24;
  border:1px solid rgba(255,255,255,0.1);
  border-radius:10px;
  box-shadow:0 16px 36px rgba(0,0,0,0.5),0 2px 6px rgba(0,0,0,0.25);
  padding:14px 16px;
  display:flex;
  flex-direction:column;
  gap:10px;
  box-sizing:border-box;
  color:#f3f4f6;
  font-size:12px;
  line-height:1.5;
  backdrop-filter:blur(16px);
}
.dshqb_pricing_models{display:flex;flex-direction:column;gap:6px}
.dshqb_pricing_card_item{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:3px}
.dshqb_pricing_model_name{font-weight:600;font-size:12px;color:#fff;font-variant-numeric:tabular-nums}
.dshqb_pricing_rates{font-size:11px;color:#9ca3af;display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.dshqb_pricing_dot{color:rgba(255,255,255,0.2)}
.dshqb_pricing_link{color:#3b82f6;text-decoration:none;font-size:11px;display:inline-flex;align-items:center;margin-top:2px}

.preview_container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}
.preview_label {
  font-size: 13px;
  font-weight: 500;
  color: #9ca3af;
}
</style>
</head>
<body>

<div class="preview_container" id="preview_main">
  <div class="preview_label">1. 输入框底部状态栏与左右双栏卡片 (悬停状态)</div>
  
  <div class="dshqb_popover">
    <div class="dshqb_col">
      <div class="dshqb_card_header">
        <span>📊 账户余额</span>
        <span class="dshqb_card_badge dshqb_card_badge_success">● 充足</span>
      </div>
      <div class="dshqb_card_row">
        <span>总额: </span>
        <span class="dshqb_card_val_main">¥97.69</span>
      </div>
      <div class="dshqb_card_sub">
        <span>充值 ¥97.69</span>
        <span>·</span>
        <span>赠送 ¥0.00</span>
      </div>
      <div class="dshqb_card_hint">
        <div>更新于 00:15:00 · 每 5 分钟 刷新</div>
        <div>💡 点击状态指示灯可立即手动刷新</div>
      </div>
    </div>
    <div class="dshqb_vsep"></div>
    <div class="dshqb_col">
      <div class="dshqb_card_header">
        <span>⚡ 本会话消耗</span>
        <span class="dshqb_card_val_main">¥3.92</span>
      </div>
      <ul class="dshqb_card_models">
        <li>
          <span>• deepseek-v4-flash</span>
          <span>¥3.92</span>
        </li>
      </ul>
      <div class="dshqb_card_hint">
        <div class="dshqb_card_tokens">
          <div>Token: 输入 124M · 输出 301K</div>
          <div class="dshqb_card_hit">命中: 123M (99.3%)</div>
        </div>
        <div>💡 计价规则与单价请见右侧 [?]</div>
      </div>
    </div>
  </div>

  <div class="dshqb_root">
    <span class="dshqb_trigger">
      <span class="dshqb_amount">
        <button class="dshqb_dot_btn" type="button"><span class="dshqb_dot dshqb_dot_success"></span></button>余额 ¥97.69
      </span>
      <span class="dshqb_sep">|</span>
      <span class="dshqb_amount">本会话约 ¥3.92</span>
    </span>
    <span class="dshqb_sep">|</span>
    <span class="dshqb_pricing_wrap">
      <a class="dshqb_pricing" href="#">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
      </a>
    </span>
  </div>
</div>

<div class="preview_container" id="preview_pricing">
  <div class="preview_label">2. DeepSeek V4 定价策略卡片 (悬停 [?] 状态)</div>
  <div class="dshqb_pricing_popover">
    <div class="dshqb_card_header">
      <span>📋 DeepSeek V4 定价参考</span>
      <span class="dshqb_card_badge dshqb_card_badge_info">每 1M tokens · CNY</span>
    </div>
    <div class="dshqb_pricing_models">
      <div class="dshqb_pricing_card_item">
        <div class="dshqb_pricing_model_name">• deepseek-v4-flash</div>
        <div class="dshqb_pricing_rates">
          <span>命中 ¥0.02</span>
          <span class="dshqb_pricing_dot">·</span>
          <span>未命中 ¥1.00</span>
          <span class="dshqb_pricing_dot">·</span>
          <span>输出 ¥2.00</span>
        </div>
      </div>
      <div class="dshqb_pricing_card_item">
        <div class="dshqb_pricing_model_name">• deepseek-v4-pro</div>
        <div class="dshqb_pricing_rates">
          <span>命中 ¥0.025</span>
          <span class="dshqb_pricing_dot">·</span>
          <span>未命中 ¥3.00</span>
          <span class="dshqb_pricing_dot">·</span>
          <span>输出 ¥6.00</span>
        </div>
      </div>
    </div>
    <a class="dshqb_pricing_link" href="#">查看官方完整定价页 ›</a>
  </div>
</div>

</body>
</html>
`

const htmlPath = path.resolve('test/preview-render.html')
fs.writeFileSync(htmlPath, htmlContent, 'utf-8')

const outPath = path.resolve('assets/preview.png')
console.log('Rendering screenshot via msedge...')
const res = spawnSync(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  '--window-size=960,820',
  '--default-background-color=00000000',
  `--screenshot=${outPath}`,
  `file:///${htmlPath.replace(/\\\\/g, '/')}`
])

if (res.error) throw res.error
console.log('Successfully captured screenshot to', outPath)
