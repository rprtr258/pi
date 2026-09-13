# Testing with Pytest

Comprehensive testing strategies using pytest and TDD methodology.

## Test-Driven Development

Follow the TDD cycle:

1. **RED**: Write a failing test for the desired behavior
2. **GREEN**: Write minimal code to make the test pass
3. **REFACTOR**: Improve code while keeping tests green

```python
# Step 1: Write failing test (RED)
def test_add_numbers():
  result = add(2, 3)
  assert result == 5

# Step 2: Write minimal implementation (GREEN)
def add(a, b):
  return a + b

# Step 3: Refactor if needed (REFACTOR)
```

Coverage targets: 80%+ overall, 100% for critical paths. Measure with `pytest --cov=mypackage --cov-report=term-missing --cov-report=html`.

## Basic Structure and Assertions

```python
# test_user.py
import pytest
from myapp.user import User, UserService

# Simple test function
def test_user_creation() -> None:
  user = User(id=1, name="Alice", email="alice@example.com")
  assert user.name == "Alice"
  assert user.is_active is True

# Test class for grouping
class TestUserService:
  def test_find_user(self) -> None:
    service = UserService()
    user = service.find(1)
    assert user is not None

  def test_create_user(self) -> None:
    service = UserService()
    user = service.create(name="Bob", email="bob@example.com")
    assert user.id > 0
```

Assertion patterns:

```python
# Equality / inequality
assert result == expected
assert result != unexpected

# Truthiness vs exact values
assert result      # truthy
assert not result    # falsy
assert result is True  # exactly True
assert result is None  # exactly None

# Membership and comparison
assert item in collection
assert 0 <= result <= 100

# Type checking
assert isinstance(result, str)

# Exception testing (preferred approach)
with pytest.raises(ValueError, match="invalid input"):
  validate_input("invalid")

# Exception attributes
with pytest.raises(CustomError) as exc_info:
  raise CustomError("error", code=400)
assert exc_info.value.code == 400
```

## Fixtures for Setup/Teardown

```python
# conftest.py - shared fixtures
import pytest
from typing import Iterator
from myapp.database import Database, Session

@pytest.fixture
def db() -> Iterator[Database]:
  """Provide database instance with cleanup."""
  database = Database("test.db")
  database.create_tables()
  yield database
  database.drop_tables()
  database.close()

@pytest.fixture
def db_session(db: Database) -> Iterator[Session]:
  """Provide database session with rollback."""
  session = db.create_session()
  yield session
  session.rollback()
  session.close()

@pytest.fixture
def sample_user() -> User:
  """Provide test user."""
  return User(id=1, name="Test User", email="test@example.com")

# Using fixtures in tests
def test_user_creation(db_session: Session, sample_user: User) -> None:
  db_session.add(sample_user)
  db_session.commit()

  retrieved = db_session.query(User).filter_by(id=1).first()
  assert retrieved.name == "Test User"

# Autouse fixture (runs automatically)
@pytest.fixture(autouse=True)
def reset_state() -> Iterator[None]:
  """Reset global state before each test."""
  clear_caches()
  yield
  cleanup_temp_files()
```

### Fixture Scopes

```python
# Function scope (default) - runs for each test
# Module scope - runs once per module
@pytest.fixture(scope="module")
def module_db():
  db = Database(":memory:")
  db.create_tables()
  yield db
  db.close()

# Session scope - runs once per test session
@pytest.fixture(scope="session")
def shared_resource():
  resource = ExpensiveResource()
  yield resource
  resource.cleanup()
```

### Parameterized Fixtures

```python
@pytest.fixture(params=["sqlite", "postgresql", "mysql"])
def db_engine(request: pytest.FixtureRequest) -> str:
  return request.param

def test_connection(db_engine: str) -> None:
  # Test runs 3 times with different engines
  assert create_connection(db_engine)
```

### Fixture Factory Pattern

```python
@pytest.fixture
def user_factory(db_session: Session):
  created_users: list[User] = []

  def _create_user(
    name: str = "Test User",
    email: str | None = None,
    **kwargs
  ) -> User:
    if email is None:
      email = f"{name.lower().replace(' ', '.')}@example.com"

    user = User(name=name, email=email, **kwargs)
    db_session.add(user)
    db_session.commit()
    created_users.append(user)
    return user

  yield _create_user

  # Cleanup
  for user in created_users:
    db_session.delete(user)
  db_session.commit()
```

## Parametrize for Multiple Cases

```python
import pytest

# Parametrize test function
@pytest.mark.parametrize(
  "input,expected",
  [
    (2, 4),
    (3, 9),
    (4, 16),
    (-2, 4),
  ]
)
def test_square(input: int, expected: int) -> None:
  assert square(input) == expected

# Multiple parameters (stacked decorators = product of both)
@pytest.mark.parametrize("base", [2, 10])
@pytest.mark.parametrize("exponent", [0, 1, 2])
def test_power(base: int, exponent: int) -> None:
  result = base ** exponent
  assert result >= 0

# Parametrize with IDs for readable test names
@pytest.mark.parametrize(
  "email,valid",
  [
    ("user@example.com", True),
    ("invalid", False),
    ("@example.com", False),
    ("user@", False),
  ],
  ids=["valid", "no_at", "no_user", "no_domain"]
)
def test_email_validation(email: str, valid: bool) -> None:
  assert is_valid_email(email) == valid

# Parametrize with fixtures
@pytest.mark.parametrize("name", ["Alice", "Bob", "Charlie"])
def test_user_names(user_factory, name: str) -> None:
  user = user_factory(name)
  assert user.name == name
```

## Markers and Test Selection

```python
import pytest

# Skip test
@pytest.mark.skip(reason="Not implemented yet")
def test_future_feature() -> None:
  pass

# Conditional skip
@pytest.mark.skipif(sys.version_info < (3, 11), reason="Requires Python 3.11+")
def test_new_feature() -> None:
  pass

# Expected failure
@pytest.mark.xfail(reason="Known bug #123")
def test_known_bug() -> None:
  assert buggy_function() == expected_value

# Custom markers
@pytest.mark.slow
def test_slow_operation() -> None:
  time.sleep(5)
  assert True

@pytest.mark.integration
def test_integration() -> None:
  assert external_service.ping()
```

```ini
# pytest.ini - register markers (required with --strict-markers)
[pytest]
markers =
  slow: marks tests as slow
  integration: marks tests as integration tests
  unit: marks tests as unit tests
```

Run with selection:

```bash
pytest -m "not slow"      # skip slow tests
pytest -m integration       # only integration tests
pytest -m "unit and not slow"   # unit tests, excluding slow ones
```

## Mocking and Patching

```python
from unittest.mock import Mock, MagicMock, patch, AsyncMock, PropertyMock
import pytest

# Mock object
def test_api_call_with_mock() -> None:
  mock_client = Mock()
  mock_client.get.return_value = {"status": "ok"}

  service = ApiService(mock_client)
  result = service.fetch_data()

  mock_client.get.assert_called_once_with("/api/data")
  assert result["status"] == "ok"

# Patch as decorator
@patch("myapp.user.send_email")
def test_user_registration(mock_send_email: Mock) -> None:
  service = UserService()
  service.register("user@example.com")

  mock_send_email.assert_called_with(
    to="user@example.com",
    subject="Welcome"
  )

# Multiple patches (decorated bottom-up)
@patch("myapp.api.requests.get")
@patch("myapp.api.cache.get")
def test_cached_api(mock_cache: Mock, mock_requests: Mock) -> None:
  mock_cache.return_value = None
  mock_requests.return_value.json.return_value = {"data": "value"}

  result = fetch_with_cache("key")

  mock_cache.assert_called_once_with("key")
  mock_requests.assert_called_once()

# Mock side effects: exception then success
@patch("mypackage.api_call")
def test_api_error_handling(api_call_mock):
  api_call_mock.side_effect = ConnectionError("Network error")

  with pytest.raises(ConnectionError):
    api_call()

  api_call_mock.assert_called_once()

def test_retry_logic() -> None:
  mock_api = Mock()
  mock_api.call.side_effect = [
    ConnectionError("Failed"),
    ConnectionError("Failed"),
    {"status": "ok"}
  ]

  result = retry_api_call(mock_api)
  assert result["status"] == "ok"
  assert mock_api.call.call_count == 3

# Mock context managers (file I/O)
@patch("builtins.open", new_callable=mock_open)
def test_file_reading(mock_file):
  mock_file.return_value.read.return_value = "file content"

  result = read_file("test.txt")

  mock_file.assert_called_once_with("test.txt", "r")
  assert result == "file content"

# Autospec catches API misuse
@patch("mypackage.DBConnection", autospec=True)
def test_autospec(db_mock):
  db = db_mock.return_value
  db.query("SELECT * FROM users")

  # Fails if DBConnection doesn't have a query method
  db_mock.assert_called_once()

# Mock properties
@pytest.fixture
def mock_config():
  config = Mock()
  type(config).debug = PropertyMock(return_value=True)
  type(config).api_key = PropertyMock(return_value="test-key")
  return config

def test_with_mock_config(mock_config):
  assert mock_config.debug is True
  assert mock_config.api_key == "test-key"
```

## Async Testing

```python
import asyncio
import pytest

# Mark async test (pytest-asyncio)
@pytest.mark.asyncio
async def test_async_fetch() -> None:
  result = await fetch_data("https://api.example.com")
  assert result["status"] == "ok"

# Async fixture
@pytest.fixture
async def async_db() -> AsyncIterator[AsyncDatabase]:
  db = AsyncDatabase()
  await db.connect()
  yield db
  await db.disconnect()

@pytest.mark.asyncio
async def test_async_query(async_db: AsyncDatabase) -> None:
  result = await async_db.query("SELECT * FROM users")
  assert len(result) > 0

# AsyncMock for async dependencies
@pytest.mark.asyncio
async def test_async_function() -> None:
  mock_db = AsyncMock()
  mock_db.fetch_user.return_value = User(id=1, name="Alice")

  service = AsyncUserService(mock_db)
  user = await service.get_user(1)

  mock_db.fetch_user.assert_awaited_once_with(1)
  assert user.name == "Alice"

# Test concurrent operations
@pytest.mark.asyncio
async def test_concurrent_requests() -> None:
  urls = ["http://example.com/1", "http://example.com/2"]
  results = await asyncio.gather(*[fetch(url) for url in urls])
  assert len(results) == 2
```

## Testing Side Effects (Files)

```python
def test_with_tmp_path(tmp_path):
  """Test using pytest's built-in temp path fixture (auto-cleaned)."""
  test_file = tmp_path / "test.txt"
  test_file.write_text("hello world")

  result = process_file(str(test_file))
  assert result == "hello world"
```

## Test Coverage

```bash
# Run with coverage
pytest --cov=myapp --cov-report=html --cov-report=term
```

```toml
# pyproject.toml
[tool.pytest.ini_options]
minversion = "7.0"
addopts = [
    "--cov=myapp",
    "--cov-report=term-missing",
    "--cov-fail-under=80",
    "-ra",
    "--strict-markers",
]
testpaths = ["tests"]
```

## Property-Based Testing

```python
from hypothesis import given, strategies as st

# Property-based test
@given(st.integers(), st.integers())
def test_addition_commutative(a: int, b: int) -> None:
  assert a + b == b + a

@given(st.lists(st.integers()))
def test_sorted_is_ordered(lst: list[int]) -> None:
  sorted_lst = sorted(lst)
  for i in range(len(sorted_lst) - 1):
    assert sorted_lst[i] <= sorted_lst[i + 1]

# Custom strategies
from hypothesis.strategies import composite

@composite
def users(draw) -> User:
  return User(
    id=draw(st.integers(min_value=1)),
    name=draw(st.text(min_size=1, max_size=50)),
    email=draw(st.emails()),
    age=draw(st.integers(min_value=18, max_value=120))
  )

@given(users())
def test_user_creation(user: User) -> None:
  assert user.age >= 18
  assert len(user.name) > 0
```

## Snapshot Testing

```python
import pytest
from syrupy.assertion import SnapshotAssertion

def test_api_response(snapshot: SnapshotAssertion) -> None:
  response = api.get_user(1)
  assert response == snapshot

def test_rendered_template(snapshot: SnapshotAssertion) -> None:
  html = render_template("user.html", user=get_user(1))
  assert html == snapshot
```

## Test Organization

```
tests/
├── conftest.py          # Shared fixtures
├── unit/                # Unit tests
│   ├── test_models.py
│   └── test_services.py
├── integration/         # Integration tests
│   └── test_api.py
└── e2e/                 # End-to-end tests
    └── test_user_flow.py
```

## Common Patterns

### Testing API Endpoints (FastAPI/Flask)

```python
@pytest.fixture
def client():
  app = create_app(testing=True)
  return app.test_client()

def test_get_user(client):
  response = client.get("/api/users/1")
  assert response.status_code == 200
  assert response.json["id"] == 1

def test_create_user(client):
  response = client.post("/api/users", json={
    "name": "Alice",
    "email": "alice@example.com"
  })
  assert response.status_code == 201
  assert response.json["name"] == "Alice"
```

### Testing Database Operations

```python
@pytest.fixture
def db_session():
  """Create a test database session with rollback."""
  session = Session(bind=engine)
  session.begin_nested()
  yield session
  session.rollback()
  session.close()

def test_create_user(db_session):
  user = User(name="Alice", email="alice@example.com")
  db_session.add(user)
  db_session.commit()

  retrieved = db_session.query(User).filter_by(name="Alice").first()
  assert retrieved.email == "alice@example.com"
```

## Running Tests

```bash
pytest                              # Run all tests
pytest tests/test_utils.py          # Run specific file
pytest tests/test_utils.py::test_function  # Run specific test
pytest -v                           # Verbose output
pytest --cov=mypackage --cov-report=html  # With coverage
pytest -m "not slow"                # Skip slow tests
pytest -x                           # Stop on first failure
pytest --maxfail=3                  # Stop after N failures
pytest --lf                         # Run last failed tests
pytest -k "test_user"               # Run tests matching pattern
pytest --pdb                        # Drop into debugger on failure
```

## Best Practices

### DO

- **Follow TDD**: Write tests before code (red-green-refactor)
- **Test one thing**: Each test should verify a single behavior
- **Use descriptive names**: `test_user_login_with_invalid_credentials_fails`
- **Use fixtures**: Eliminate duplication with fixtures
- **Mock external dependencies**: Don't depend on external services
- **Test edge cases**: Empty inputs, None values, boundary conditions
- **Aim for 80%+ coverage**: Focus on critical paths
- **Keep tests fast**: Use marks to separate slow tests

### DON'T

- **Don't test implementation**: Test behavior, not internals
- **Don't use complex conditionals in tests**: Keep tests simple
- **Don't ignore test failures**: All tests must pass
- **Don't test third-party code**: Trust libraries to work
- **Don't share state between tests**: Tests should be independent
- **Don't catch exceptions in tests**: Use `pytest.raises`
- **Don't write tests that are too brittle**: Avoid over-specific mocks

## Quick Reference

| Pattern | Usage |
|---------|-------|
| `pytest.raises()` | Test expected exceptions |
| `@pytest.fixture()` | Create reusable test fixtures |
| `@pytest.mark.parametrize()` | Run tests with multiple inputs |
| `@pytest.mark.slow` | Mark slow tests |
| `pytest -m "not slow"` | Skip slow tests |
| `@patch()` | Mock functions and classes |
| `tmp_path` fixture | Automatic temp directory |
| `pytest --cov` | Generate coverage report |
| `assert` | Simple and readable assertions |

**Remember**: Tests are code too. Keep them clean, readable, and maintainable. Good tests catch bugs; great tests prevent them.
