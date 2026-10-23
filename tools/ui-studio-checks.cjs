const assert = require('node:assert/strict')

module.exports = async function checkStudio({ evaluate, waitFor }) {
  const generate = `Array.from(document.querySelectorAll('button')).find(element => element.textContent.includes('开始生成')).click()`
  await waitFor(`Boolean(document.querySelector('#view-studio'))`)
  await evaluate(`document.querySelector('#view-studio').click()`)
  await waitFor(`Boolean(Array.from(document.querySelectorAll('select')).find(element => element.labels[0]?.textContent.includes('模型')))`)
  await evaluate(`document.querySelector('#studio-job').textContent = ''; ${generate}`)
  await waitFor(`Boolean(document.querySelector('#studio-job').textContent)`)
  const payload = JSON.parse(await evaluate(`document.querySelector('#studio-job').textContent`))
  assert.equal(payload.modelBinding.bundleId, 'fixture-bundle')
  assert.equal(payload.deviceId, 'cuda:0')
  assert.equal(payload.prompt, 'Fixture prompt')
  console.log('Studio checks passed: model/device selection and instance-free engine payload')
}
