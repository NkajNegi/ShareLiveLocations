const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'location-tracker',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
  connectionTimeout: 10000,
  requestTimeout: 30000,
  ssl: process.env.KAFKA_SASL_USERNAME ? true : false,
  sasl: process.env.KAFKA_SASL_USERNAME ? {
    mechanism: 'scram-sha-256',
    username: process.env.KAFKA_SASL_USERNAME,
    password: process.env.KAFKA_SASL_PASSWORD,
  } : undefined,
});

const producer = kafka.producer();
const consumerRealtime = kafka.consumer({ 
  groupId: 'group-realtime',
  sessionTimeout: 30000,
  heartbeatInterval: 3000
});
const consumerPersistence = kafka.consumer({ 
  groupId: 'group-persistence',
  sessionTimeout: 30000,
  heartbeatInterval: 3000
});

const admin = kafka.admin();

const initKafka = async () => {
  await admin.connect();
  const topics = await admin.listTopics();
  const TOPIC = 'location_updates';
  if (!topics.includes(TOPIC)) {
    await admin.createTopics({
      topics: [{ topic: TOPIC, numPartitions: 1, replicationFactor: 1 }],
    });
    console.log(`Topic ${TOPIC} created`);
  }
  await admin.disconnect();

  await producer.connect();
  await consumerRealtime.connect();
  await consumerPersistence.connect();
  console.log('Kafka Producer and Consumers connected');
};

module.exports = {
  producer,
  consumerRealtime,
  consumerPersistence,
  initKafka,
};
