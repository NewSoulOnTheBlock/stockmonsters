import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true, userDataDir: mkdtempSync(join(tmpdir(),'e-')), args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] })
for (const [n,w,h] of [['DESKTOP',1280,900],['PHONE',390,844]]) {
  const p = await b.newPage(); await p.setViewport({width:w,height:h})
  await p.goto('http://localhost:4173',{waitUntil:'networkidle0'})
  const r = await p.evaluate(() => {
    const pill = document.querySelector('main .bg-line')
    return { pillText: pill.innerText.replace(/\s+/g,' ').trim(),
      copyBtn: !!document.querySelector('button[aria-label^="Copy the"]'),
      blockscout: [...document.querySelectorAll('a')].filter(a=>/blockscout/.test(a.href)).length,
      anyAddr: /0x[a-fA-F0-9]{40}/.test(document.body.innerText) }
  })
  console.log(`${n}: pill="${r.pillText}" copyButton=${r.copyBtn} blockscoutLinks=${r.blockscout} any0xOnPage=${r.anyAddr}`)
  await p.screenshot({ path: `${process.env.OUT}/empty-${n.toLowerCase()}.png` })
  await p.close()
}
await b.close()
