FROM quay.io/buildah/stable:v1.38

USER root
RUN microdnf install -y git && microdnf clean all

RUN useradd --create-home --uid 1001 builder

RUN echo "builder:100000:65536" >> /etc/subuid && \
    echo "builder:100000:65536" >> /etc/subgid

USER builder

WORKDIR /home/builder

ENV STORAGE_DRIVER=vfs