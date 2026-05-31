const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse({
    body: req.body,
    query: req.query,
    params: req.params,
    headers: req.headers,
  });

  if (!result.success) {
    return res.status(400).json({
      error: 'Dados inválidos',
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  req.validated = result.data;
  next();
};

module.exports = validate;
