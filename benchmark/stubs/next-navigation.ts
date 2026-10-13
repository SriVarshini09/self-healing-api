export function redirect(url: string): never {
  throw new Error(`redirect(${url}) called inside a webhook handler`);
}
