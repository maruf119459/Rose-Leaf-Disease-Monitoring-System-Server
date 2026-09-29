/**
 * inferenceWorker.js
 * -------------------
 * Runs inside a Node.js worker_thread (see modelWorkerPool.js). Each worker
 * loads its own copy of the ResNet50 model ONCE at startup and then answers
 * "predict" messages from the main thread. Running inference here — instead
 * of directly in an Express route handler — is what lets the server keep
 * answering OTHER requests (sensor ingestion, log queries, etc.) instantly
 * even while a CPU-heavy image classification is in progress, and lets
 * several detection requests be processed in parallel across workers.
 */
const { parentPort } = require("worker_threads");
const path = require("path");
const tf = require("@tensorflow/tfjs-node");

const LABELS = require("./labels.json");
const MODEL_PATH =
  process.env.MODEL_PATH || `file://${path.join(__dirname, "tfjs_model", "model.json")}`;

let model = null;

async function loadModel() {
  model = await tf.loadLayersModel(MODEL_PATH);

  // Warm-up pass: the first inference on a freshly loaded TF graph is
  // noticeably slower (kernel compilation/allocation). Doing one dummy
  // prediction now means the FIRST real user request is fast too.
  const dummy = tf.zeros([1, 224, 224, 3]);
  const warm = model.predict(dummy);
  await warm.data();
  dummy.dispose();
  warm.dispose();

  parentPort.postMessage({ type: "ready" });
}

/**
 * Replicates tf.keras.applications.resnet50.preprocess_input (mode="caffe"):
 * convert RGB -> BGR, then zero-center each channel using the ImageNet
 * means. This step was originally baked into the trained Keras model as a
 * Lambda layer; Lambda layers wrapping arbitrary Python functions do not
 * survive TensorFlow.js conversion, so the deploy model (see
 * scripts/export_for_tfjs.py) was exported WITHOUT that layer, and the
 * exact same preprocessing math is reproduced here in JavaScript instead.
 */
function preprocess(buffer) {
  return tf.tidy(() => {
    let img = tf.node.decodeImage(buffer, 3); // [h, w, 3] int32, RGB
    img = tf.image.resizeBilinear(img, [224, 224]);
    img = img.toFloat();

    const [r, g, b] = tf.split(img, 3, -1);
    const bgr = tf.concat([b, g, r], -1);
    const mean = tf.tensor1d([103.939, 116.779, 123.68]);
    const preprocessed = bgr.sub(mean);

    return preprocessed.expandDims(0); // [1, 224, 224, 3]
  });
}

async function predict(buffer) {
  const input = preprocess(buffer);
  const output = model.predict(input);
  const scores = Array.from(await output.data());
  input.dispose();
  output.dispose();

  let maxIdx = 0;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > scores[maxIdx]) maxIdx = i;
  }

  const allScores = {};
  LABELS.forEach((label, i) => (allScores[label] = scores[i]));

  return { label: LABELS[maxIdx], confidence: scores[maxIdx], allScores };
}

parentPort.on("message", async (msg) => {
  if (msg.type !== "predict") return;
  try {
    const buffer = Buffer.from(msg.buffer);
    const result = await predict(buffer);
    parentPort.postMessage({ type: "result", id: msg.id, result });
  } catch (err) {
    parentPort.postMessage({ type: "error", id: msg.id, error: err.message });
  }
});

loadModel().catch((err) => {
  parentPort.postMessage({ type: "load-error", error: err.message });
});
