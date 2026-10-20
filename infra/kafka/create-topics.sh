#!/bin/bash
# Creates every topic in topics.conf that doesn't exist yet, then exits -- run once per start by the
# compose `kafka-init` service; invoice, payment and mail-service wait for it to complete.
#
# Why it exists: with broker auto-creation, a topic only appeared when some client first asked for
# it, and the first consumer to subscribe on a fresh broker lost that race ("This server does not
# host this topic-partition") -- payment failed to start. It also left partitions to broker defaults.
#
# Never changes an existing topic: raising partitions moves keys to other partitions, which breaks
# per-invoice ordering for messages in flight, so a mismatch is reported for a human to decide.
# Plain bash only: the apache/kafka image has no grep/awk.
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP_SERVER:-kafka:9092}"
REPLICATION_FACTOR="${TOPIC_REPLICATION_FACTOR:-1}"
TOPICS_FILE="${TOPICS_FILE:-/topics/topics.conf}"
KAFKA_TOPICS=/opt/kafka/bin/kafka-topics.sh

while read -r name partitions _; do
  [[ -z "${name}" || "${name}" == \#* ]] && continue

  "${KAFKA_TOPICS}" --bootstrap-server "${BOOTSTRAP}" --create --if-not-exists \
    --topic "${name}" --partitions "${partitions}" --replication-factor "${REPLICATION_FACTOR}" >/dev/null

  description="$("${KAFKA_TOPICS}" --bootstrap-server "${BOOTSTRAP}" --describe --topic "${name}")"
  actual="${description#*PartitionCount: }"
  actual="${actual%%[!0-9]*}"
  if [[ "${actual}" != "${partitions}" ]]; then
    echo "WARNING: topic ${name} has ${actual} partition(s), topics.conf says ${partitions}; left unchanged."
  else
    echo "topic ${name}: ${partitions} partition(s)"
  fi
done < "${TOPICS_FILE}"
