# Functional Verification Protocol

## Purpose

This protocol ensures that every function works correctly before, during, and after changes.

## Before Making ANY Change

### 1. Identify Impact
- Which functions will be modified?
- Which functions depend on those functions?
- Check `FUNCTIONAL-MATRIX.md` for test status

### 2. Verify Baseline
```bash
# Run all existing tests
npm test

# Run type checking
npm run type-check

# Run linting
npm run lint
```

### 3. Document Expected Behavior
- What does the function do now?
- What will change?
- Why is the change needed?

## While Making Changes

### 1. Test-Driven Development
- Write tests BEFORE changing code
- Run tests after EVERY change
- Use watch mode for rapid feedback

```bash
# Watch mode for rapid testing
npm test -- --watch

# Test specific file
npm test -- <filename>.test.ts
```

### 2. Incremental Changes
- Change ONE thing at a time
- Commit after each verified change
- Never have >100 lines changed without tests

### 3. Continuous Verification
```bash
# After each change
npm test
npm run type-check
```

## After Making Changes

### 1. Full Test Suite
```bash
# All tests must pass
npm test

# Check coverage hasn't decreased
npm test -- --coverage
```

### 2. Integration Verification
```bash
# Run integration tests
npm test -- src/__tests__/integration/

# Verify end-to-end workflows
npm test -- src/__tests__/integration/end-to-end.test.ts
```

### 3. Manual Verification for Critical Paths

**Critical Path 1: Index and Search**
```bash
# Start CLI
npm start

# In REPL:
> index
> search "test query"
> status
```

**Critical Path 2: Project Migration**
```bash
# In REPL:
> discover
# Should list folders or return "no matches"
```

**Critical Path 3: MCP Server**
- Restart Claude Code CLI
- Test one MCP tool
- Verify it responds correctly

### 4. Update Documentation
- Update `FUNCTIONAL-MATRIX.md` if tests added
- Update JSDoc if function signature changed
- Update `CHANGELOG.md` if user-visible change

## Before Git Commit

### Pre-Commit Checklist
```bash
# This runs automatically via husky
npm run type-check
npm run lint
npm test
```

All must pass before commit is allowed.

### Manual Checklist
- [ ] All tests pass
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Coverage not decreased
- [ ] Documentation updated
- [ ] CHANGELOG updated (if needed)

## Red Flags - STOP and Review

🚫 **NEVER commit if**:
- Any test fails
- Type checking fails
- Linting has warnings/errors
- Coverage decreased without reason
- Manual verification shows unexpected behavior
- Edge cases not tested

## Recovery from Failed Verification

### 1. Identify What Broke
```bash
# Run tests with verbose output
npm test -- --verbose

# Check which test failed
npm test -- --testNamePattern="<test name>"
```

### 2. Compare with Previous Version
```bash
# See what changed
git diff HEAD

# Compare with last working commit
git diff HEAD~1
```

### 3. Revert if Needed
```bash
# Revert specific file
git checkout HEAD -- <file>

# Verify it works
npm test
```

### 4. Fix Incrementally
- Revert to working state
- Make ONE small change
- Run tests
- Repeat until fixed

## Verification Commands Reference

```bash
# Quick verification
npm test

# Full verification
npm test -- --coverage
npm run type-check
npm run lint
npm run build

# Specific tests
npm test -- <file>.test.ts
npm test -- --testNamePattern="<pattern>"

# Watch mode
npm test -- --watch

# Update snapshots (only if intentional change)
npm test -- -u
```

## Phase-Specific Protocols

### Phase 0-1: Establishing Baseline
- Run tests before starting
- Capture baseline metrics
- No failures allowed

### Phase 2: Increasing Coverage
- Every new test must pass
- Coverage must increase
- No regressions allowed

### Phase 3-4: Refactoring
- Tests prove equivalence
- Performance within 5%
- All integration tests pass

### Phase 5-6: Advanced Features
- New features fully tested
- Backward compatibility maintained
- Documentation complete

## Success Criteria

✅ **Ready to commit when**:
- All tests pass (147+ tests)
- Coverage stable or improved
- Type checking passes
- Linting passes (0 warnings)
- Manual verification completed
- Documentation updated

✅ **Ready to merge when**:
- All commit criteria met
- Integration tests pass
- Performance benchmarks acceptable
- Code review approved
- CHANGELOG updated

✅ **Ready to release when**:
- All merge criteria met
- Version bumped appropriately
- Release notes prepared
- npm audit passes
- Manual smoke test completed

## Emergency Procedures

### If Tests Fail on CI
1. Reproduce locally: `npm test`
2. Check CI logs for environment differences
3. Fix locally and verify
4. Push fix

### If Tests Pass Locally but Fail on CI
- Check Node version match
- Check for timing-dependent tests
- Check for environment-specific code
- Add CI-specific configuration if needed

### If Manual Verification Fails
- File a bug immediately
- Revert the change
- Add test to catch the issue
- Fix with test coverage

## Contact

For questions about verification protocol:
- Check this document first
- Review `FUNCTIONAL-MATRIX.md`
- Check existing tests for examples
- Ask in PR review

---

**Last Updated**: 2025-01-07
**Version**: 1.0 (Phase 0)
