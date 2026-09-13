# API Implementation Patterns

Framework-specific request-handling patterns consistent with RFC 7807 error responses, 201 Created with Location, and schema validation.

## TypeScript (Next.js API Route)

```typescript
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      type: "https://api.example.com/errors/validation-error",
      title: "Validation Error",
      status: 422,
      errors: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    }, { status: 422, headers: { "Content-Type": "application/problem+json" } });
  }

  const user = await createUser(parsed.data);

  return NextResponse.json(
    { data: user },
    {
      status: 201,
      headers: { Location: `/api/v1/users/${user.id}` },
    },
  );
}
```

## Python (Django REST Framework)

```python
from rest_framework import serializers, viewsets, status
from rest_framework.response import Response

class CreateUserSerializer(serializers.Serializer):
  email = serializers.EmailField()
  name = serializers.CharField(max_length=100)

class UserSerializer(serializers.ModelSerializer):
  class Meta:
    model = User
    fields = ["id", "email", "name", "created_at"]

class UserViewSet(viewsets.ModelViewSet):
  serializer_class = UserSerializer
  permission_classes = [IsAuthenticated]

  def get_serializer_class(self):
    if self.action == "create":
      return CreateUserSerializer
    return UserSerializer

  def create(self, request):
    serializer = CreateUserSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = UserService.create(**serializer.validated_data)
    return Response(
      {"data": UserSerializer(user).data},
      status=status.HTTP_201_CREATED,
      headers={"Location": f"/api/v1/users/{user.id}"},
    )
```

## Go (net/http)

```go
func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeProblem(w, http.StatusBadRequest, "invalid_json", "Invalid request body")
        return
    }

    if err := req.Validate(); err != nil {
        writeProblem(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
        return
    }

    user, err := h.service.Create(r.Context(), req)
    if err != nil {
        switch {
        case errors.Is(err, domain.ErrEmailTaken):
            writeProblem(w, http.StatusConflict, "email_taken", "Email already registered")
        default:
            writeProblem(w, http.StatusInternalServerError, "internal_error", "Internal error")
        }
        return
    }

    w.Header().Set("Location", fmt.Sprintf("/api/v1/users/%s", user.ID))
    writeJSON(w, http.StatusCreated, map[string]any{"data": user})
}
```

`writeProblem` writes `application/problem+json` with the RFC 7807 fields (`type`, `title`, `status`, `detail`).
