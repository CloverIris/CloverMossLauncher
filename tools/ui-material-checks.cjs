const assert = require('node:assert/strict')

module.exports = async function checkMaterials({ evaluate, webContents }) {
  await evaluate(`(() => {
    const surface = document.createElement('div')
    surface.id = 'material-probe'
    surface.style.cssText = 'position:fixed;inset:0;z-index:9999;background:repeating-linear-gradient(90deg,#eee 0 8px,#333 8px 16px)'
    const card = document.createElement('div')
    card.className = 'glass'
    card.style.cssText = 'position:absolute;inset:15%'
    surface.append(card)
    document.body.append(surface)
  })()`)
  try {
    // Check the compiled CSS in Chromium: a source declaration alone does not
    // prove that the CSS optimizer preserved a property this engine supports.
    for (const name of ['glass', 'glass-thin', 'glass-strong', 'content-surface']) {
      await evaluate(`document.querySelector('#material-probe > div').className = ${JSON.stringify(name)}; void 0`)
      const filter = await evaluate('getComputedStyle(document.querySelector("#material-probe > div")).backdropFilter')
      assert.match(filter, /blur\(/, `${name} lost its backdrop filter in compiled CSS: ${filter}`)
    }
    await evaluate('const probe = document.querySelector("#material-probe > div"); probe.className = "glass"; probe.style.background = "transparent"; void 0')
    const deviation = async () => {
      // Hidden windows can return a stale composited frame on their first capture.
      await webContents.capturePage()
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const rect = await evaluate(`(() => {
        const box = document.querySelector('#material-probe > div').getBoundingClientRect()
        return { x: box.x + box.width / 2 - 32, y: box.y + box.height / 2 - 8, width: 64, height: 16 }
      })()`)
      const scale = webContents.getZoomFactor()
      const area = Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * scale)]))
      const bitmap = (await webContents.capturePage(area)).toBitmap()
      const values = Array.from({ length: bitmap.length / 4 }, (_, index) => bitmap[index * 4 + 2])
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
    }
    const blurred = await deviation()
    await evaluate('document.querySelector("#material-probe > div").style.backdropFilter = "none"; void 0')
    const sharp = await deviation()
    assert.ok(sharp > 30, `Expected a detailed backdrop, got deviation ${sharp}`)
    assert.ok(blurred < sharp / 5, `Backdrop pixels stayed sharp: blur ${blurred}, control ${sharp}`)
    console.log(`Material checks passed: compiled filters and pixel blur (${blurred.toFixed(2)} vs ${sharp.toFixed(2)})`)
  } finally {
    await evaluate('document.querySelector("#material-probe").remove()')
  }
}
