FROM golang:1.25-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 produces a fully static binary -- required for the scratch runtime below (no libc
# there for a dynamically-linked binary to resolve against). This is the main payoff of picking
# segmentio/kafka-go over confluent-kafka-go: no cgo/librdkafka to drag into a static build at all.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /mail ./cmd/mail

# scratch has no CA bundle and no shell -- both copied in explicitly below. No Node-style "one
# shared dev image size cost" tradeoff applies here: this is the one and only image this service
# ever runs, dev or prod, so it's worth keeping it this lean unconditionally.
FROM scratch

COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=builder /mail /mail

ENTRYPOINT ["/mail"]
