export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}
export const badRequest = (m, d) => new HttpError(400, m, d)
export const notFound = (m) => new HttpError(404, m)
export const conflict = (m, d) => new HttpError(409, m, d)
