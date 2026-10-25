import { HttpError } from '../common/http-error.js';

export const errorHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  if (error.type === 'entity.parse.failed') {
    response.status(400).json({
      error: {
        code: 'invalid_json',
        message: 'Request body must be JSON',
      },
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong',
    },
  });
};
