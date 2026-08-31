import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: mkdtempSync(join(tmpdir(),'p-')), args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] })
const p = await b.newPage(); await p.setViewport({width:390,height:844,isMobile:true})
await p.goto('http://localhost:4173', {waitUntil:'networkidle0'})
const hits = await p.evaluate(() => {
  const out = []
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let n; while ((n = w.nextNode())) if (n.nodeValue.includes('75%')) out.push([n.parentElement.tagName+'.'+n.parentElement.className, n.parentElement.closest('section,footer')?.querySelector('h2,h3')?.innerText, n.nodeValue.trim().slice(0,160)])
  return out
})
console.log(JSON.stringify(hits, null, 1))
// can the user actually pan sideways?
const pan = await p.evaluate(() => { window.scrollTo(9999, 0); const x = window.scrollX; window.scrollTo(0,0); return { scrollX: x, docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, clientW: document.documentElement.clientWidth } })
console.log('pan:', JSON.stringify(pan))
await b.close()
