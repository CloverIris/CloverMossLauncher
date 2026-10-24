import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function writeDpiReport(directory) {
  const reports = [100, 125, 150, 175, 200].map(scale => JSON.parse(readFileSync(join(directory, `dpi-${scale}.json`), 'utf8')))
  const native = JSON.parse(readFileSync(join(directory, 'native-display.json'), 'utf8'))
  const rows = reports.flatMap(report => report.rows)
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
  const summary = rows.filter(row => row.page === 'studio').map(row => `<tr><td>${row.factor * 100}%</td><td>${escape(row.profile)}</td><td>${row.available.width} × ${row.available.height}</td><td>${row.bounds.width} × ${row.bounds.height}</td><td>${row.windowFits ? '是' : '否'}</td><td>${row.navigationItem.fontSize}px</td><td>${row.input.fontSize}px / ${Math.round(row.input.height)}px</td><td>${Math.round(row.canvas.width)} × ${Math.round(row.canvas.height)}</td><td>${row.textBelow12}/${row.textRuns}</td></tr>`).join('')
  const figures = rows.map(row => `<figure><figcaption>${row.factor * 100}% · ${escape(row.profile)} · ${row.page} · DPR ${row.dpr} · zoom ${row.zoom}</figcaption><a href="${escape(row.screenshot)}"><img loading="lazy" src="${escape(row.screenshot)}" alt="${escape(row.page)} ${row.factor * 100}%"></a></figure>`).join('')
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ native, reports }, null, 2))
  writeFileSync(join(directory, 'index.html'), `<!doctype html>
<html lang="zh-CN">
<meta charset="UTF-8"><title>MossStudio DPI 审查</title>
<style>
body{font:15px/1.6 system-ui;margin:28px;background:#191b1f;color:#e9eef7}
h1{font-size:24px;font-weight:500}table{border-collapse:collapse;white-space:nowrap}
td,th{padding:6px 10px;border:1px solid #555;text-align:left;font-weight:400}
figure{margin:24px 0}img{max-width:100%;height:auto;border:1px solid #555}
a{color:#8ab6ff}figcaption{margin-bottom:8px}
</style>
<h1>MossStudio DPI 审查</h1>
<p>独立 Electron 进程强制设备缩放；网页 zoom 固定为 1。使用实际 App / 页面和内存 IPC，不读写用户数据，也不修改 Windows 显示设置。此结果不等同于跨显示器拖动验收。</p>
<p>本机：${escape(native.map(display => `${display.label}: ${display.scaleFactor * 100}%, ${display.size.width}×${display.size.height} DIP`).join('；'))}。default 为生产默认尺寸；work-area 为本机工作区；1080p-work-area 为 1920×1080 显示器并预留 40 DIP 任务栏的受控窗口测试。最小窗口限制仍保留。</p>
<table><thead><tr><th>DPI</th><th>场景</th><th>可用 DIP</th><th>实际窗口 DIP</th><th>放得下</th><th>导航字号</th><th>输入字号 / 高度</th><th>画布区 DIP</th><th>小于 12px 的文字段</th></tr></thead>
<tbody>${summary}</tbody></table>
<p>截图保留原始像素，可点击打开；浏览器缩放后的预览不代表实际物理大小。</p>
${figures}
</html>`)
  console.log(`DPI report: ${join(directory, 'index.html')}`)
}
