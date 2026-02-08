.PHONY: build clean test-docker release

build:
	yarn build

clean:
	rm -rf dist

test-docker:
	yarn test:docker

release:
ifndef plugin
	$(error plugin is required. Usage: make release plugin=open-library-enricher tag=0.2.0)
endif
ifndef tag
	$(error tag is required. Usage: make release plugin=open-library-enricher tag=0.2.0)
endif
ifeq ($(dry-run),1)
	./scripts/release.sh $(plugin) $(tag) --dry-run
else
	./scripts/release.sh $(plugin) $(tag)
endif
