FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o obsync-server .

FROM scratch
COPY --from=builder /app/obsync-server /obsync-server

VOLUME ["/data"]

EXPOSE 4377

ENV PORT=4377
ENV DATA_DIR=/data

ENTRYPOINT ["/obsync-server"]
