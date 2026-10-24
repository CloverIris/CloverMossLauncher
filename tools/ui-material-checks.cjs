const assert = require('node:assert/strict')

module.exports = async function checkMaterials({ evaluate, waitFor, webContents }) {
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
    const deviation = async (selector = '#material-probe > div') => {
      // Hidden windows can return a stale composited frame on their first capture.
      await webContents.capturePage()
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      // The native compositor can still hold the previous backdrop frame after
      // RAF; allow the updated material to commit before sampling its pixels.
      await new Promise((resolve) => setTimeout(resolve, 220))
      const rect = await evaluate(`(() => {
        const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
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
    await evaluate('document.querySelector("#material-probe").remove(); document.documentElement.dataset.uiAnimation = "on"; document.querySelector("#view-materials").click()')
    await waitFor('Boolean(document.querySelector("#material-page-card"))')
    await evaluate('document.querySelector("[data-testid=page-motion]").getAnimations().forEach(animation => animation.finish())')
    await waitFor('document.querySelector("[data-testid=page-motion]").getAnimations().length === 0')
    const freeze = async (selector, fraction) => evaluate(`
      for (const animation of document.querySelector(${JSON.stringify(selector)}).getAnimations({ subtree: true })) {
        animation.pause()
        animation.currentTime = Number(animation.effect.getTiming().duration) * ${fraction}
      }; void 0
    `)
    const assertFrosted = async (selector, name) => {
      const value = await deviation(selector)
      const opacity = await evaluate(`Number(getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity)`)
      // A fading glass layer blends its blurred pixels with the sharp backdrop.
      // Its blur contribution must follow opacity, rather than vanish entirely
      // until an ancestor reaches opacity 1.
      assert.ok(value < sharp * (1 - opacity * 0.8) + 1, `${name} lost backdrop blur: deviation ${value}, control ${sharp}, opacity ${opacity}`)
    }
    for (const progress of [0.1, 0.5, 0.9]) {
      await freeze('#material-page', progress)
      await assertFrosted('#material-page-card', `Page entrance at ${progress}`)
    }
    await freeze('#material-page', 0.5)
    assert.equal(await evaluate('getComputedStyle(document.querySelector("#material-page")).opacity'), '1')
    assert.equal(await evaluate('(() => { const opacity = Number(getComputedStyle(document.querySelector("#material-page-card")).opacity); return opacity > 0 && opacity < 1 })()'), true, 'The material must still fade')
    for (let i = 0; i < 3; i++) {
      await evaluate('document.querySelector("#material-restart").click()')
      await freeze('#material-page', 0.5)
      assert.equal(await evaluate('document.querySelector("#material-page").getAnimations({ subtree: true }).length'), 2, 'A new page transition must release the previous animation group')
    }
    await assertFrosted('#material-page-card', 'Restarted page')
    await evaluate('document.querySelector("#material-layer").click()')
    await waitFor('Boolean(document.querySelector("#material-layer-card"))')
    await freeze('#material-layer-panel', 0.5)
    await assertFrosted('#material-layer-card', 'Layer entrance')
    await evaluate('document.querySelector("#material-toggle").click()')
    await waitFor('document.querySelector("#material-layer-panel").dataset.motionState === "closed"')
    await freeze('#material-layer-panel', 0.5)
    await assertFrosted('#material-layer-card', 'Layer exit')
    const exitingOpacity = await evaluate('Number(getComputedStyle(document.querySelector("#material-layer-card")).opacity)')
    await evaluate('document.querySelector("#material-toggle").click()')
    const reopeningOpacity = await evaluate('Number(getComputedStyle(document.querySelector("#material-layer-card")).opacity)')
    assert.ok(Math.abs(reopeningOpacity - exitingOpacity) < 0.02, 'Reversing a fade must preserve the material opacity')
    await freeze('#material-layer-panel', 0.5)
    await assertFrosted('#material-layer-card', 'Reversed layer')
    await evaluate('document.documentElement.dataset.uiAnimation = "off"')
    await waitFor('document.querySelector("#material-layer-panel").getAnimations({subtree:true}).length === 0')
    await assertFrosted('#material-layer-card', 'Disabled animation')
    console.log('Material motion checks passed: fading page, layer entrance/exit/reversal, preference cleanup')
  } finally {
    await evaluate('document.querySelector("#material-probe")?.remove(); document.querySelector("#view-controls").click()')
    await waitFor('Boolean(document.querySelector("#open-modal"))')
  }
}
