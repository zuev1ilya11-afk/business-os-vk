FROM postgres:17.6
RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*
ENV BOS_RECOVERY_PG_BIN=/usr/lib/postgresql/17/bin
USER postgres
WORKDIR /repo
ENTRYPOINT ["python3", "deploy/recovery/test_postgres.py", "--require"]
