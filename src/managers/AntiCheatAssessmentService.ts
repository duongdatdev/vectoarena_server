import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import prisma from "../database/prisma";
import { AntiCheatFeatureSnapshot } from "./AntiCheatTracker";

type AssessmentLabel = "Normal" | "Review" | "Suspicious";

type AssessmentResult = {
  score: number;
  label: AssessmentLabel;
  modelVersion: string;
  reasonCodes: string[];
};

const REVIEW_THRESHOLD = 0.5;
const SUSPICIOUS_THRESHOLD = 0.75;
const SCORER_TIMEOUT_MS = 5000;

export class AntiCheatAssessmentService {
  constructor(
    private readonly pythonCommand = process.env.ANTICHEAT_SCORER_PYTHON || defaultPythonCommand(),
    private readonly scorerPath = path.resolve(__dirname, "../../ml/score_anticheat.py")
  ) {}

  async assessParticipant(matchParticipantId: string, featureSnapshot: AntiCheatFeatureSnapshot): Promise<void> {
    const assessment = await this.scoreWithModel(featureSnapshot).catch((error) => {
      console.error("[AntiCheat] ML scorer failed, using fallback rules:", error);
      return this.scoreWithFallbackRules(featureSnapshot);
    });

    if (!assessment) return;

    await (prisma as any).antiCheatAssessment.create({
      data: {
        matchParticipantId,
        score: assessment.score,
        label: assessment.label,
        modelVersion: assessment.modelVersion,
        reasonCodes: assessment.reasonCodes,
        featureSnapshot,
      },
    });
  }

  labelForScore(score: number): AssessmentLabel {
    if (score >= SUSPICIOUS_THRESHOLD) return "Suspicious";
    if (score >= REVIEW_THRESHOLD) return "Review";
    return "Normal";
  }

  private async scoreWithModel(featureSnapshot: AntiCheatFeatureSnapshot): Promise<AssessmentResult> {
    const rawResult = await this.runScorer(featureSnapshot);
    const parsed = JSON.parse(rawResult) as Partial<AssessmentResult>;
    const score = this.clampScore(Number(parsed.score));
    const label = this.isKnownLabel(parsed.label) ? parsed.label : this.labelForScore(score);
    const reasonCodes = Array.isArray(parsed.reasonCodes)
      ? parsed.reasonCodes.filter((reason): reason is string => typeof reason === "string")
      : [];

    return {
      score,
      label,
      modelVersion: typeof parsed.modelVersion === "string" ? parsed.modelVersion : "rf-synthetic-v1",
      reasonCodes,
    };
  }

  private runScorer(featureSnapshot: AntiCheatFeatureSnapshot): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonCommand, [this.scorerPath], {
        cwd: path.resolve(__dirname, "../.."),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`scorer timeout after ${SCORER_TIMEOUT_MS}ms`));
      }, SCORER_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
          return;
        }
        reject(new Error(stderr.trim() || `scorer exited with code ${code}`));
      });

      child.stdin.write(JSON.stringify(featureSnapshot));
      child.stdin.end();
    });
  }

  private scoreWithFallbackRules(featureSnapshot: AntiCheatFeatureSnapshot): AssessmentResult | null {
    const reasonCodes: string[] = [];
    let score = 0;

    if (featureSnapshot.invalidHitCount > 0) {
      reasonCodes.push("high_invalid_hit");
      score += 0.35;
    }
    if (featureSnapshot.moveClampCount > 2) {
      reasonCodes.push("high_move_clamp");
      score += 0.25;
    }
    if (featureSnapshot.pickupRejectCount > 2) {
      reasonCodes.push("high_pickup_reject");
      score += 0.2;
    }
    if (featureSnapshot.fireRateRejectCount > 1) {
      reasonCodes.push("high_fire_rate_reject");
      score += 0.2;
    }

    if (reasonCodes.length === 0) return null;

    const clampedScore = this.clampScore(score);
    return {
      score: clampedScore,
      label: this.labelForScore(clampedScore),
      modelVersion: "rules-fallback-v1",
      reasonCodes,
    };
  }

  private clampScore(score: number): number {
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(1, score));
  }

  private isKnownLabel(label: unknown): label is AssessmentLabel {
    return label === "Normal" || label === "Review" || label === "Suspicious";
  }
}

function defaultPythonCommand(): string {
  const serverRoot = path.resolve(__dirname, "../..");
  const windowsVenvPython = path.join(serverRoot, "ml", ".venv", "Scripts", "python.exe");
  const unixVenvPython = path.join(serverRoot, "ml", ".venv", "bin", "python");

  if (existsSync(windowsVenvPython)) return windowsVenvPython;
  if (existsSync(unixVenvPython)) return unixVenvPython;
  return "python";
}
