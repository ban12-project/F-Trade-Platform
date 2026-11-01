variable "ARCH" {
  default = "amd64"
}
variable "IMAGE_PREFIX" {
  default = "ftrade"
}
variable "BUILD_TAG" {
  default = "local"
}
variable "REVISION" {
  default = "local"
}
variable "SOURCE" {
  default = "https://github.com/ban12-project/F-Trade-Platform"
}

group "default" {
  targets = ["agent", "browser"]
}

target "common" {
  platforms = ["linux/${ARCH}"]
  labels = {
    "org.opencontainers.image.source" = SOURCE
    "org.opencontainers.image.revision" = REVISION
  }
}

target "agent" {
  inherits = ["common"]
  context = "."
  dockerfile = "ops/browser-node/Dockerfile"
  tags = ["${IMAGE_PREFIX}-browser-node:${BUILD_TAG}-${ARCH}"]
  cache-from = ["type=gha,scope=ftrade-browser-agent-${ARCH}"]
  cache-to = ["type=gha,scope=ftrade-browser-agent-${ARCH},mode=max"]
}

target "browser" {
  inherits = ["common"]
  context = "ops/browser-node"
  dockerfile = "browser.Dockerfile"
  args = {
    TARGETARCH = ARCH
  }
  tags = ["${IMAGE_PREFIX}-browser:${BUILD_TAG}-${ARCH}"]
  cache-from = ["type=gha,scope=ftrade-browser-runtime-${ARCH}"]
  cache-to = ["type=gha,scope=ftrade-browser-runtime-${ARCH},mode=max"]
}
