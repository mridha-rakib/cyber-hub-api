export type ServiceHealth = "healthy" | "unhealthy";

export interface HealthResponse {
  status: "ok";
  timestamp: string;
  uptime: number;
  environment: string;
  services: {
    application: ServiceHealth;
    database: ServiceHealth;
  };
}
