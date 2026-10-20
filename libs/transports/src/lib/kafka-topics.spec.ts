import { readFileSync } from 'fs';
import { join } from 'path';
import { INVOICE_EVENTS_TOPIC } from './invoice-events.types';

/**
 * The broker's topic auto-creation is off: a topic exists only if infra/kafka/topics.conf lists it
 * (the compose kafka-init service creates them). A topic the code or a service's config uses but
 * the list lacks would fail only at runtime, on a fresh broker -- so it fails here instead.
 */
const ROOT = join(__dirname, '../../../..');

function provisionedTopics(): Map<string, number> {
  const topics = new Map<string, number>();
  for (const line of readFileSync(join(ROOT, 'infra/kafka/topics.conf'), 'utf8').split('\n')) {
    const [name, partitions] = line.trim().split(/\s+/);
    if (!name || name.startsWith('#')) continue;
    topics.set(name, Number(partitions));
  }
  return topics;
}

/** Every topic a compose file hands a service through a KAFKA_TOPIC_* variable. */
function composeTopics(file: string): string[] {
  return [...readFileSync(join(ROOT, file), 'utf8').matchAll(/^\s+KAFKA_TOPIC_[A-Z_]+:\s*([\w.-]+)\s*$/gm)].map(
    (match) => match[1],
  );
}

describe('provisioned Kafka topics (infra/kafka/topics.conf)', () => {
  const topics = provisionedTopics();

  it('lists the topic invoice publishes to and payment consumes', () => {
    expect(topics.has(INVOICE_EVENTS_TOPIC)).toBe(true);
  });

  it.each(['docker-compose.dev.yml', 'docker-compose.prod.yml'])('lists every topic %s configures', (file) => {
    const configured = composeTopics(file);

    expect(configured.length).toBeGreaterThan(0);
    expect(configured.filter((topic) => !topics.has(topic))).toEqual([]);
  });

  it('gives every topic a positive partition count', () => {
    expect([...topics.values()].every((partitions) => Number.isInteger(partitions) && partitions > 0)).toBe(true);
  });
});
