// PATCH /api/_server/alerts/:id — acknowledge or resolve an alert (clinicians only).
export const config = { roles: ['clinician', 'admin'] };

export async function PATCH({ query, request }) {
  const id = Number(request.params.id);
  const status = request.body?.status;
  if (!['open', 'acknowledged', 'resolved'].includes(status)) return { status: 400, body: { message: 'status must be open, acknowledged or resolved' } };
  const [row] = await query(
    `UPDATE alerts SET status = $2, acknowledged_at = CASE WHEN $2 = 'open' THEN NULL ELSE COALESCE(acknowledged_at, NOW()) END WHERE id = $1 RETURNING *`,
    [id, status],
  );
  if (!row) return { status: 404, body: { message: 'Alert not found' } };
  return row;
}
