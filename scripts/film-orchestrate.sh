#!/bin/bash
# Video pipeline v2 — hard timeouts on every external call, robust retries.
cd /tmp/film
PUB=/home/z/my-project/public/film
STYLE="photorealistic, ultra detailed, cinematic film, volumetric light, shallow depth of field, film grain, muted warm paper palette, deep ink-black shadows, single signal-red accent, slow deliberate camera movement, 2.39:1 widescreen composition, no readable text, no logos"

P1="Cinematic macro dolly shot inside a government records archive at dusk: towering stacks of thick paper tender documents and binders receding into darkness, dust motes drifting through warm volumetric light shafts, one red file marker glowing among the paper, $STYLE"
P2="Cinematic close-up at night: a thin beam of scanner light sweeping slowly across dense printed document pages on a dark desk, fine paper texture revealed by the moving light, faint luminous particles lifting off the page, macro lens, $STYLE"
P3="Cinematic floating paper document pages suspended in dark space, thin red threads connecting highlighted passages from one page to other pages across the void, threads drawing taut one by one, soft volumetric glow, slow orbital camera, $STYLE"
P4="Cinematic macro shot: a small red flag pin rising into focus on a thick stack of paper documents, red ink slowly pulsing along a printed line like a heartbeat, background stacks dissolving into darkness, dramatic rim light, $STYLE"
P5="Cinematic close-up of a human hand hovering above a single glowing red wax-seal button on a dark committee table, neat stacks of documents and a stethoscope beside it, dramatic rim lighting, the tense moment before the press, $STYLE"
P6="Cinematic wide shot: early morning sunlight flooding a government committee chamber, a wooden gavel resting on a stack of documents tied with a red ribbon, dust motes in golden volumetric light, long shadows, calm resolution after tension, $STYLE"

echo "orchestrator v2 start $(date)" >> orchestrator.log

# Phase 1 — create missing tasks sequentially (timeout 90s per attempt)
for i in 1 2 3 4 5 6; do
  if [ ! -s gen-$i.json ] || ! grep -q '"id"' gen-$i.json; then
    for attempt in 1 2 3 4 5 6; do
      echo "creating task $i attempt $attempt $(date)" >> orchestrator.log
      timeout 90 z-ai video -p "${P[$i]}" --quality quality --size 1920x1080 --fps 30 --duration 10 -o gen-$i.json >> create-$i.log 2>&1
      if grep -q '"id"' gen-$i.json 2>/dev/null; then echo "task $i created $(date)" >> orchestrator.log; break; fi
      sleep 20
    done
  fi
  sleep 8
done

echo "all tasks created $(date)" >> orchestrator.log

# Phase 2 — poll each & download (timeout 20 min per clip)
for i in 1 2 3 4 5 6; do
  if [ -f "$PUB/chapter-$i.mp4" ] && [ "$(stat -c%s $PUB/chapter-$i.mp4 2>/dev/null)" -gt 200000 ]; then
    echo "task $i already downloaded" >> orchestrator.log
    continue
  fi
  ID=$(grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' gen-$i.json | head -1 | sed 's/.*"id"[[:space:]]*:[[:space:]]*"//;s/"$//')
  [ -z "$ID" ] && { echo "task $i: no id" >> orchestrator.log; continue; }
  echo "polling task $i ($ID) $(date)" >> orchestrator.log
  for attempt in 1 2 3; do
    timeout 1300 z-ai async-result --id "$ID" --poll --poll-interval 15 --max-polls 80 -o gen-$i.final.json >> poll-$i.log 2>&1
    grep -q 'SUCCESS\|video_result' gen-$i.final.json 2>/dev/null && break
    sleep 15
  done
  URL=$(bun -e "const d=require('/tmp/film/gen-$i.final.json');console.log((d.video_result&&d.video_result[0]&&d.video_result[0].url)||d.video_url||d.url||d.video||'')" 2>/dev/null)
  if [ -n "$URL" ]; then
    for attempt in 1 2 3; do
      timeout 300 curl -sL --retry 2 "$URL" -o $PUB/chapter-$i.mp4
      SIZE=$(stat -c%s $PUB/chapter-$i.mp4 2>/dev/null || echo 0)
      [ "$SIZE" -gt 200000 ] && break
      sleep 10
    done
    echo "task $i downloaded ($SIZE bytes) $(date)" >> orchestrator.log
  else
    echo "task $i: no url in final json $(date)" >> orchestrator.log
  fi
done

echo "PIPELINE COMPLETE $(date)" >> orchestrator.log
touch all-done
