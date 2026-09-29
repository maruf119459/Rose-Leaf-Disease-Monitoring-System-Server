function errorHandler(err, req, res, next) {
  console.error("[Error]", err);

  if (err.type === "entity.too.large" || err.message === "File too large") {
    return res.status(413).json({ status: "error", message: "Uploaded file is too large (max 8 MB)" });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    status: "error",
    message: statusCode === 500 ? "Internal server error" : err.message,
  });
}

module.exports = errorHandler;
