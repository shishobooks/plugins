.PHONY: build clean test-docker release

build:
	yarn build

clean:
	rm -rf dist

test-docker:
	yarn test:docker

release:
ifndef tag
	$(error tag is required. Usage: make release tag=0.1.0)
endif
ifdef dry-run
	./scripts/release.sh $(tag) --dry-run
else
	./scripts/release.sh $(tag)
endif
