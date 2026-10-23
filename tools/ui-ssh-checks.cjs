const assert = require('node:assert/strict')

module.exports = async function checkSsh({ evaluate, waitFor, capture }) {
  const click = (text) => `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`
  const input = (label) => `Array.from(document.querySelectorAll('input')).find(input => input.labels[0]?.textContent.trim().startsWith(${JSON.stringify(label)}))`
  const set = async (label, value) => evaluate(`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(${input(label)}, ${JSON.stringify(value)}); ${input(label)}.dispatchEvent(new Event('input', { bubbles: true }))`)
  const tab = (method) => `document.querySelector('#ssh-auth-tab-${method}')`
  const panel = (method) => `document.querySelector('#ssh-auth-panel-${method}')`
  const request = `JSON.parse(document.querySelector('#host-request').textContent)`
  const checkInputBounds = async (label, fullWidth) => {
    await waitFor(`Boolean(document.querySelector('dialog[open][data-motion-state="open"]'))`)
    await evaluate(`document.getAnimations().filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime)).forEach(animation => animation.finish())`)
    await evaluate(`${input(label)}.scrollIntoView({ block: 'center' }); ${input(label)}.focus()`)
    const geometry = await evaluate(`(() => {
      const element = ${input(label)};
      const bounds = element.getBoundingClientRect();
      const reference = ${input('模型 / 缓存根目录')}.getBoundingClientRect();
      const normal = ${input('Host')}.getBoundingClientRect();
      const style = getComputedStyle(element);
      const ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      const clips = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowX !== 'hidden') continue;
        const clip = parent.getBoundingClientRect();
        clips.push(bounds.left - ring >= clip.left - 0.5 && bounds.right + ring <= clip.right + 0.5);
      }
      return { left: Math.abs(bounds.left - reference.left), right: Math.abs(bounds.right - reference.right), height: bounds.height, normalHeight: normal.height, ring, clips };
    })()`)
    assert(geometry.left < .5, `${label}: left edge is misaligned`)
    if (fullWidth) assert(geometry.right < .5, `${label}: right edge is misaligned`)
    assert.equal(geometry.height, geometry.normalHeight)
    assert(geometry.ring > 0, `${label}: focus outline must be visible`)
    assert(geometry.clips.every(Boolean), `${label}: focus outline is clipped`)
  }
  await evaluate(`document.querySelector('#view-devices').click()`)
  await waitFor(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '添加 SSH 设备')`)
  await evaluate(click('添加 SSH 设备'))
  await waitFor(`${tab('identityFile')}?.getAttribute('aria-selected') === 'true'`)
  await evaluate(click('选择文件'))
  await waitFor(`${input('Identity file')}.value.includes('key with spaces')`)
  await checkInputBounds('Identity file', false)
  await capture('ssh-identity')
  assert.equal(await evaluate(`JSON.parse(document.querySelector('#pick-request').textContent).kind`), 'file')
  await set('Host', '127.0.0.1')
  await set('User', 'fixture')
  await evaluate(click('保存并测试'))
  await waitFor(`!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`${request}.authMethod`), 'identityFile')
  assert.equal(await evaluate(`${request}.identityFile`), 'C:\\Users\\fixture\\.ssh\\key with spaces')

  await evaluate(click('编辑'))
  await waitFor(`${tab('identityFile')}?.getAttribute('aria-selected') === 'true'`)
  await evaluate(`${tab('identityFile')}.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  await waitFor(`${tab('password')}.getAttribute('aria-selected') === 'true'`)
  assert.equal(await evaluate(`${panel('identityFile')}.inert`), true)
  assert.equal(await evaluate(`${panel('password')}.inert`), false)
  await set('SSH 密码', 'fixture password')
  assert.equal(await evaluate(`${input('SSH 密码')}.type`), 'password')
  await checkInputBounds('SSH 密码', true)
  await capture('ssh-password')
  await evaluate(click('保存并测试'))
  await waitFor(`!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`${request}.authMethod`), 'password')
  assert.equal(await evaluate(`${request}.password`), 'fixture password')
  assert.equal(await evaluate(`${request}.identityFile`), undefined)

  await evaluate(click('编辑'))
  await waitFor(`${tab('password')}?.getAttribute('aria-selected') === 'true'`)
  assert.equal(await evaluate(`${input('SSH 密码')}.value`), '')
  assert.equal(await evaluate(`${input('SSH 密码')}.placeholder`), '留空保留已保存的密码')
  await evaluate(click('保存并测试'))
  await waitFor(`!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`${request}.password`), undefined)

  await evaluate(click('编辑'))
  await waitFor(`Boolean(${tab('none')})`)
  await evaluate(`${tab('none')}.click()`)
  await waitFor(`${tab('none')}.getAttribute('aria-selected') === 'true'`)
  await capture('ssh-none')
  await evaluate(click('保存并测试'))
  await waitFor(`!document.querySelector('dialog[open]')`)
  assert.equal(await evaluate(`${request}.authMethod`), 'none')
  assert.equal(await evaluate(`${request}.password`), undefined)
  assert.equal(await evaluate(`${request}.identityFile`), undefined)
  await evaluate(`document.querySelector('#view-controls').click()`)
  await waitFor(`!document.querySelector('#ssh-auth-tab-none')`)
  await evaluate(`document.querySelector('#view-devices').click()`)
  await waitFor(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '编辑')`)
  await evaluate(click('编辑'))
  await waitFor(`${tab('none')}?.getAttribute('aria-selected') === 'true'`)
  await evaluate(click('取消'))
  await waitFor(`!document.querySelector('dialog[open]')`)
  console.log('SSH UI checks passed: file picker, sliding tabs, keyboard navigation, password editing, no authentication')
}
