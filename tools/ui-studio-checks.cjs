const assert = require('node:assert/strict')

module.exports = async function checkStudio({ evaluate, waitFor }) {
  const select = `Array.from(document.querySelectorAll('select')).find(element => element.labels[0]?.textContent.includes('实例'))`
  const generate = `Array.from(document.querySelectorAll('button')).find(element => element.textContent.includes('开始生成')).click()`
  const value = `${select}?.value`
  const submit = async (id) => {
    await evaluate(`document.querySelector('#studio-job').textContent = ''; ${generate}`)
    await waitFor(`Boolean(document.querySelector('#studio-job').textContent)`)
    assert.equal(await evaluate(`JSON.parse(document.querySelector('#studio-job').textContent).instanceId`), id)
  }
  const choose = async (id) => {
    await evaluate(`${select}.value = '${id}'; ${select}.dispatchEvent(new Event('change', { bubbles: true }))`)
    await waitFor(`${value} === '${id}'`)
  }

  await waitFor(`Boolean(document.querySelector('#view-studio'))`)
  await evaluate(`document.querySelector('#view-studio').click()`)
  await waitFor(`Boolean(${select})`)
  await evaluate(generate)
  await waitFor(`document.body.textContent.includes('先选择一个实例')`)
  assert.equal(await evaluate(`document.querySelector('#studio-job').textContent`), '')

  // An asynchronously loaded list must update both the displayed and submitted ID.
  await evaluate(`document.querySelector('#load-instances').click()`)
  await waitFor(`${value} === 'instance-a'`)
  await submit('instance-a')
  await choose('instance-b')
  await evaluate(`document.querySelector('#load-instances').click()`)
  await submit('instance-b')
  await evaluate(`document.querySelector('#remove-instance-b').click()`)
  await waitFor(`${value} === 'instance-a'`)
  await submit('instance-a')

  // A launch request may arrive before the instance list, or target an open window.
  await choose('instance-a')
  await evaluate(`document.querySelector('#clear-instances').click()`)
  await waitFor(`${value} === ''`)
  await evaluate(`document.querySelector('#studio-job').textContent = ''; ${generate}`)
  assert.equal(await evaluate(`document.querySelector('#studio-job').textContent`), '')
  await evaluate(`document.querySelector('#request-instance-b').click()`)
  await evaluate(`document.querySelector('#load-instances').click()`)
  await waitFor(`${value} === 'instance-b'`)
  await submit('instance-b')
  await choose('instance-a')
  await evaluate(`document.querySelector('#request-instance-b').click()`)
  await waitFor(`${value} === 'instance-b'`)
  await submit('instance-b')

  // The launcher's selection must travel in the IPC route, not a window-local store.
  await evaluate(`document.querySelector('#view-home').click(); document.querySelector('#load-devices').click()`)
  await waitFor(`Boolean(${select})`)
  await choose('instance-b')
  await waitFor(`!Array.from(document.querySelectorAll('button')).find(element => element.textContent.includes('打开 MossStudio')).disabled`)
  await evaluate(`document.querySelector('#window-request').textContent = ''`)
  await evaluate(`Array.from(document.querySelectorAll('button')).find(element => element.textContent.includes('打开 MossStudio')).click()`)
  await waitFor(`Boolean(document.querySelector('#window-request').textContent)`)
  assert.deepEqual(await evaluate(`JSON.parse(document.querySelector('#window-request').textContent)`), {
    target: 'studio', route: '/studio?instanceId=instance-b',
  })
  console.log('Studio checks passed: async selection, generation payload, list refresh/removal, repeated launch requests, launcher handoff')
}
