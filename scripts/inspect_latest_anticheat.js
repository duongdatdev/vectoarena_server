require("dotenv").config();

const { Pool } = require("pg");

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const sql = `
    select
      t.*,
      a.score as assessment_score,
      a.label as assessment_label,
      a."modelVersion" as assessment_model_version,
      p.id as participant_id,
      p."usernameSnapshot",
      p."userId",
      p.kills,
      p.deaths,
      p."damageDealt",
      p."damageTaken",
      p.placement,
      p."survivedSeconds",
      m.id as match_id,
      m."roomCode",
      m.mode,
      m.status,
      m."durationSeconds",
      m."endedAt"
    from "AntiCheatTelemetry" t
    join "MatchParticipant" p on p.id = t."matchParticipantId"
    join "Match" m on m.id = p."matchId"
    left join lateral (
      select score, label, "modelVersion"
      from "AntiCheatAssessment"
      where "matchParticipantId" = p.id
      order by "createdAt" desc
      limit 1
    ) a on true
    order by t."createdAt" desc
    limit 10
  `;

  const { rows } = await pool.query(sql);
  console.log(JSON.stringify(rows, null, 2));
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
