import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class PathServiceTest {
    @Test
    public void returnsSeparator() {
        PathService service = new PathService();
        assertEquals("/", service.separator());
    }
}
