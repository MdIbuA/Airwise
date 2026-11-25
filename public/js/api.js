/**
 * JSON POST helper shared by the plan and narrative requests.
 */

/**
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{ ok: boolean, status: number, data: any }>}
 */
export async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
