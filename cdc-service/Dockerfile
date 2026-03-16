FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /app

# Copy POM and download dependencies (cached layer)
COPY pom.xml ./
RUN mvn dependency:go-offline -q

# Copy proto files and source code
COPY src/ ./src/

# Build fat JAR
RUN mvn clean package -DskipTests -q

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

# Copy the fat JAR from builder
COPY --from=builder /app/target/cdc-service-1.0.0.jar ./cdc-service.jar

# Create directory for Debezium offset storage
RUN mkdir -p /app/data

CMD ["java", "-jar", "cdc-service.jar"]
