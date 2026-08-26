import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const expectedServiceUrls = {
  "comandero-app": "https://zeus.tailfad2e3.ts.net/",
  "comandero-www": "https://zeus.tailfad2e3.ts.net:3201/es",
  snow: "https://zeus.tailfad2e3.ts.net:3300/accounting/",
  "snowmonster-web": "https://zeus.tailfad2e3.ts.net:3302/",
  orchestrero: "https://zeus.tailfad2e3.ts.net:3310/",
  qr: "https://zeus.tailfad2e3.ts.net:3301/",
  "bistrot-web": "https://zeus.tailfad2e3.ts.net:3303/",
  till: "https://zeus.tailfad2e3.ts.net/till",
  gpu: "https://zeus.tailfad2e3.ts.net:3300/gpu/",
  radar: "https://zeus.tailfad2e3.ts.net:3300/radar/",
  "activity-tracker": "https://zeus.tailfad2e3.ts.net:3304/",
}

function extractServiceUrls(html) {
  const markers = [...html.matchAll(/<div class="service" data-service="([^"]+)"/g)]
  return Object.fromEntries(
    markers.map((marker, index) => {
      const end = markers[index + 1]?.index ?? html.length
      const segment = html.slice(marker.index, end)
      const href = segment.match(/<a class="open"[^>]+href="([^"]+)"/)
      return [marker[1], href?.[1] ?? null]
    }),
  )
}

test("every Zeus service card uses its canonical non-IP URL", async () => {
  const html = await readFile(new URL("./zeus-home-index.html", import.meta.url), "utf8")
  assert.deepEqual(extractServiceUrls(html), expectedServiceUrls)
})

test("the local inference dashboard uses its canonical non-IP URL", async () => {
  const html = await readFile(new URL("./zeus-home-index.html", import.meta.url), "utf8")
  assert.match(
    html,
    /href="https:\/\/zeus\.tailfad2e3\.ts\.net:3300\/local-inference\/"[^>]*>[\s\S]*?data-title-id="entry:local-inference"/,
  )
})
