#!/usr/bin/env bash
# Measure what one Stockmonsters session actually costs on this machine, and
# extrapolate how many players this box can serve.
#
# Run it ON THE SERVER, with the container already up and at least one player
# connected and actually moving around in the game (an idle title screen
# measures nothing useful).
#
#   ./measure.sh              # 60 second sample
#   ./measure.sh 180          # 3 minute sample
set -euo pipefail

CONTAINER="${CONTAINER:-stockmonsters}"
SECONDS_TO_SAMPLE="${1:-60}"
INTERVAL=2

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "No container named '$CONTAINER'. Set CONTAINER=<name> or start it first." >&2
  exit 1
fi

CORES="$(nproc)"
echo "=========================================================="
echo " Stockmonsters capacity measurement"
echo "=========================================================="
echo "Host      : $(nproc) cores, $(free -g | awk '/^Mem:/{print $2}') GB RAM"
echo "CPU       : $(awk -F: '/model name/{print $2; exit}' /proc/cpuinfo | sed 's/^ *//')"
echo "Container : $CONTAINER"
echo "Sampling  : ${SECONDS_TO_SAMPLE}s"
echo

# --- steal time baseline ----------------------------------------------------
# On a shared/burstable vCPU the hypervisor can take cycles away from us. That
# shows up as "steal". Sustained video encoding is exactly the workload that
# suffers, so this number decides whether this instance type is viable at all.
read_steal() { awk '/^cpu /{print $8}' /proc/stat; }
read_total() { awk '/^cpu /{s=0; for(i=2;i<=11;i++) s+=$i; print s}' /proc/stat; }
steal_start="$(read_steal)"; total_start="$(read_total)"

# --- container network baseline ---------------------------------------------
net_rx_tx() { docker exec "$CONTAINER" cat /proc/net/dev 2>/dev/null \
    | awk '/eth0|ens/{rx+=$2; tx+=$10} END{print rx" "tx}'; }
read -r rx_start tx_start <<<"$(net_rx_tx)"

# --- sample docker stats ----------------------------------------------------
samples=0; cpu_sum=0; cpu_max=0; mem_max=0
end=$(( $(date +%s) + SECONDS_TO_SAMPLE ))
printf "%-8s %-10s %-12s\n" "t" "CPU%" "MEM"
while [ "$(date +%s)" -lt "$end" ]; do
  line="$(docker stats --no-stream --format '{{.CPUPerc}} {{.MemUsage}}' "$CONTAINER" 2>/dev/null || true)"
  [ -z "$line" ] && break
  cpu="$(echo "$line" | awk '{gsub(/%/,"",$1); print $1}')"
  mem="$(echo "$line" | awk '{print $2}')"
  mem_mb="$(echo "$mem" | sed 's/MiB//;s/GiB/*1024/' | bc -l 2>/dev/null || echo 0)"
  cpu_sum="$(echo "$cpu_sum + $cpu" | bc -l)"
  cpu_max="$(echo "if ($cpu > $cpu_max) $cpu else $cpu_max" | bc -l)"
  mem_max="$(echo "if ($mem_mb > $mem_max) $mem_mb else $mem_max" | bc -l)"
  samples=$((samples+1))
  printf "%-8s %-10s %-12s\n" "$(date +%H:%M:%S)" "$cpu%" "$mem"
  sleep "$INTERVAL"
done

[ "$samples" -eq 0 ] && { echo "No samples collected." >&2; exit 1; }

# --- results ----------------------------------------------------------------
steal_end="$(read_steal)"; total_end="$(read_total)"
steal_pct="$(echo "scale=2; 100 * ($steal_end - $steal_start) / ($total_end - $total_start + 1)" | bc -l)"
read -r rx_end tx_end <<<"$(net_rx_tx)"
tx_mbps="$(echo "scale=2; ($tx_end - $tx_start) * 8 / $SECONDS_TO_SAMPLE / 1000000" | bc -l)"

cpu_avg="$(echo "scale=1; $cpu_sum / $samples" | bc -l)"
cores_avg="$(echo "scale=2; $cpu_avg / 100" | bc -l)"
cores_peak="$(echo "scale=2; $cpu_max / 100" | bc -l)"

echo
echo "=========================================================="
echo " RESULTS"
echo "=========================================================="
printf "CPU  average : %s%% of one core  (%s cores)\n" "$cpu_avg" "$cores_avg"
printf "CPU  peak    : %s%% of one core  (%s cores)\n" "$cpu_max" "$cores_peak"
printf "RAM  peak    : %.0f MB\n" "$mem_max"
printf "Egress       : %s Mbps\n" "$tx_mbps"
printf "Steal time   : %s%%\n" "$steal_pct"
echo

# Leave headroom: never plan to run a box at 100%.
usable="$(echo "scale=2; $CORES * 0.75" | bc -l)"
if (( $(echo "$cores_peak > 0" | bc -l) )); then
  fits="$(echo "scale=0; $usable / $cores_peak" | bc -l)"
  echo "This box ($CORES cores, 75% target) fits about ${fits} concurrent"
  echo "ISOLATED sessions. For 50 you would need roughly"
  echo "$(echo "scale=1; 50 * $cores_peak / 0.75" | bc -l) cores."
  echo
  echo "In a SHARED room the game+encode cost is paid once; only the"
  echo "per-viewer packetisation scales. Measure that by connecting more"
  echo "viewers to the same room and re-running this."
fi

echo
if (( $(echo "$steal_pct > 5" | bc -l) )); then
  echo "WARNING: ${steal_pct}% steal time. This shared-vCPU instance is being"
  echo "throttled by the hypervisor. Video encoding will stutter under load —"
  echo "move to a dedicated-CPU instance before sizing anything up."
else
  echo "Steal time is low (${steal_pct}%) — this instance is not being throttled."
fi
