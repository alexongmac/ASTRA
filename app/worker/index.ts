import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from "@aws-sdk/client-sqs";
import { processMessage } from "../lib/ingest";

// Next.js loads .env.local for the web app, but this worker is a plain Node
// process, so it has to do that itself for local runs. In EKS the Deployment
// supplies the real environment, and these files do not exist there.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}

const queueUrl = process.env.SQS_QUEUE_URL;
if (!queueUrl) throw new Error("SQS_QUEUE_URL is required");

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? "us-east-1" });

let running = true;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    running = false;
  });
}

// IoT rules publish the raw MQTT payload as the message body, but an SQS action
// configured with a message template may wrap it - unwrap that case too.
function parseBody(body: string): unknown {
  const parsed = JSON.parse(body);
  if (parsed && typeof parsed === "object" && "payload" in parsed && typeof parsed.payload === "string") {
    return JSON.parse(parsed.payload);
  }
  return parsed;
}

async function handleBatch(messages: Message[]) {
  const done: { Id: string; ReceiptHandle: string }[] = [];

  for (const message of messages) {
    if (!message.Body || !message.ReceiptHandle || !message.MessageId) continue;
    try {
      await processMessage(parseBody(message.Body));
      done.push({ Id: message.MessageId, ReceiptHandle: message.ReceiptHandle });
    } catch (error) {
      // Leave the message on the queue; SQS redelivers and the redrive policy
      // moves it to the DLQ after the configured number of attempts.
      console.error(`Failed to process message ${message.MessageId}:`, error);
    }
  }

  if (done.length > 0) {
    await sqs.send(new DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: done }));
  }
}

async function main() {
  console.log(`Worker polling ${queueUrl}`);

  while (running) {
    try {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          VisibilityTimeout: 30,
        }),
      );

      if (response.Messages?.length) await handleBatch(response.Messages);
    } catch (error) {
      console.error("Poll failed:", error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log("Worker stopped");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
